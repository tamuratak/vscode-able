import * as readline from 'node:readline'
import { inspect } from 'node:util'
import { isPromise } from 'node:util/types'
import * as vm from 'node:vm'
import { PlaywrightReplExecRequest, PlaywrightReplHostCallRequest, PlaywrightReplHostCallResult, PlaywrightReplHostToKernelMessage, PlaywrightReplKernelToHostMessage, PlaywrightReplResetRequest } from './protocol.js'

interface PendingHostCall {
    resolve: (value: string) => void
    reject: (error: Error) => void
}

let callCounter = 0
const pendingHostCalls = new Map<string, PendingHostCall>()
let sandbox = createSandbox()
const noopScript = new vm.Script('undefined')
const dynamicImportPattern = /\bimport\s*\(/u

const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
})

rl.on('line', (line) => {
    const message = parseMessage(line)
    if (!message) {
        return
    }
    if (message.type === 'exec') {
        void onExec(message)
        return
    }
    if (message.type === 'reset') {
        onReset(message)
        return
    }
    onHostCallResult(message)
})

function onReset(message: PlaywrightReplResetRequest): void {
    sandbox = createSandbox()
    writeLine({
        type: 'result',
        id: message.id,
        ok: true,
        logs: [],
        value: 'kernel reset completed',
    })
}

async function onExec(message: PlaywrightReplExecRequest): Promise<void> {
    const logs: string[] = []
    sandbox.setLogger((line) => {
        logs.push(line)
    })

    try {
        const wrapped = `(async () => {\n${message.code}\n})()`
        const value = stringifyValue(await runWrappedCode(wrapped, sandbox.context, message.timeoutms))

        writeLine({
            type: 'result',
            id: message.id,
            ok: true,
            value,
            logs,
        })
    } catch (error) {
        writeLine({
            type: 'result',
            id: message.id,
            ok: false,
            error: formatError(error),
            logs,
        })
    }
}

async function runWrappedCode(wrappedCode: string, context: vm.Context, timeoutms: number): Promise<unknown> {
    if (typeof vm.SourceTextModule === 'function') {
        const module = new vm.SourceTextModule(`export default await ${wrappedCode}`, {
            context,
            identifier: 'playwrightreplcell.mjs',
            importModuleDynamically: rejectImportDynamically,
        })

        await module.link(rejectImportLinker)
        await module.evaluate({ timeout: timeoutms })
        return Reflect.get(module.namespace, 'default')
    }

    if (containsDynamicImport(wrappedCode)) {
        throw new Error('import is disabled in playwright repl')
    }

    const script = new vm.Script(wrappedCode, {
        filename: 'playwrightreplcell.js',
        importModuleDynamically: rejectImportDynamically,
    })

    // node:vm currently types runInContext return value as any.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const scriptResult = script.runInContext(context, {
        timeout: timeoutms,
    })

    return resolveScriptResult(scriptResult, context, timeoutms)
}

function resolveScriptResult(value: unknown, context: vm.Context, timeoutms: number): unknown {
    if (!isPromiseLike(value)) {
        return value
    }

    return waitForContextPromise(value, context, timeoutms)
}

async function waitForContextPromise(promise: Promise<unknown>, context: vm.Context, timeoutms: number): Promise<unknown> {
    let settled = false
    let rejected = false
    let settledValue: unknown = undefined
    let settledError: unknown = undefined

    promise.then((value) => {
        settled = true
        settledValue = value
    }, (error) => {
        settled = true
        rejected = true
        settledError = error
    })

    const deadline = Date.now() + timeoutms

    while (!settled) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) {
            throw new Error(`Script execution timed out after ${String(timeoutms)}ms`)
        }

        noopScript.runInContext(context, {
            timeout: remaining,
        })
        await waitForHostTurn()
    }

    if (rejected) {
        throw settledError
    }

    return settledValue
}

function waitForHostTurn(): Promise<void> {
    return new Promise<void>((resolve) => {
        setImmediate(resolve)
    })
}

function containsDynamicImport(source: string): boolean {
    return dynamicImportPattern.test(source)
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
    return isPromise(value)
}

function rejectImportLinker(): never {
    throw new Error('import is disabled in playwright repl')
}

function rejectImportDynamically(): never {
    throw new Error('import is disabled in playwright repl')
}

function onHostCallResult(message: PlaywrightReplHostCallResult): void {
    const pending = pendingHostCalls.get(message.id)
    if (!pending) {
        return
    }
    pendingHostCalls.delete(message.id)
    if (message.ok) {
        pending.resolve(message.value ?? '')
        return
    }
    pending.reject(new Error(message.error ?? 'playwright host call failed'))
}

function createSandbox(): {
    readonly context: vm.Context
    setLogger: (logger: (line: string) => void) => void
} {
    let logger: ((line: string) => void) | undefined

    const callHost = async (method: string, args: readonly string[]): Promise<string> => {
        const id = `call-${callCounter}`
        callCounter += 1

        const request: PlaywrightReplHostCallRequest = {
            type: 'pwcall',
            id,
            method,
            args,
        }

        writeLine(request)

        return new Promise<string>((resolve, reject) => {
            pendingHostCalls.set(id, { resolve, reject })
        })
    }

    const consoleApi = Object.freeze({
        log: (...args: readonly string[]) => {
            const line = args.join(' ')
            if (logger) {
                logger(line)
            }
        },
    })

    const pageApi = Object.freeze({
        goto: async (url: string) => callHost('page.goto', [url]),
        click: async (selector: string) => callHost('page.click', [selector]),
        fill: async (selector: string, value: string) => callHost('page.fill', [selector, value]),
        title: async () => callHost('page.title', []),
        url: async () => callHost('page.url', []),
        content: async () => callHost('page.content', []),
        textcontent: async (selector: string) => callHost('page.textcontent', [selector]),
        screenshot: async (format: 'png' | 'jpeg' = 'png') => callHost('page.screenshot', [format]),
    })

    const contextApi = Object.freeze({
        cookies: async () => callHost('context.cookies', []),
    })

    const helpersApi = Object.freeze({})

    const pwApi = Object.freeze({
        page: pageApi,
        context: contextApi,
        helpers: helpersApi,
    })

    const globalObject = {
        console: consoleApi,
        pw: pwApi,
        queueMicrotask: undefined,
        setTimeout: undefined,
        setInterval: undefined,
        setImmediate: undefined,
        require: undefined,
        process: undefined,
        module: undefined,
        Buffer: undefined,
    }

    const context = vm.createContext(globalObject, {
        codeGeneration: {
            strings: false,
            wasm: false,
        },
        microtaskMode: 'afterEvaluate',
    })

    return {
        context,
        setLogger: (nextLogger) => {
            logger = nextLogger
        },
    }
}

function parseMessage(line: string): PlaywrightReplHostToKernelMessage | undefined {
    try {
        const parsed = JSON.parse(line) as Record<string, unknown>
        return toHostMessage(parsed)
    } catch {
        return undefined
    }
}

function writeLine(message: PlaywrightReplKernelToHostMessage): void {
    process.stdout.write(`${JSON.stringify(message)}\n`)
}

function stringifyValue(value: unknown): string {
    if (typeof value === 'string') {
        return value
    }
    if (value === undefined) {
        return 'undefined'
    }
    try {
        return JSON.stringify(value)
    } catch {
        return inspect(value, { depth: 2, breakLength: 120 })
    }
}

function formatError(error: unknown): string {
    if (error instanceof Error) {
        return error.stack ?? error.message
    }
    return String(error)
}

function toHostMessage(value: unknown): PlaywrightReplHostToKernelMessage | undefined {
    if (!isObjectRecord(value)) {
        return undefined
    }

    const typeValue = value['type']
    if (typeValue === 'exec') {
        const id = value['id']
        const code = value['code']
        const timeoutms = value['timeoutms']
        if (typeof id === 'string' && typeof code === 'string' && typeof timeoutms === 'number') {
            return {
                type: 'exec',
                id,
                code,
                timeoutms,
            }
        }
        return undefined
    }

    if (typeValue === 'reset') {
        const id = value['id']
        if (typeof id === 'string') {
            return {
                type: 'reset',
                id,
            }
        }
        return undefined
    }

    if (typeValue === 'pwresult') {
        const id = value['id']
        const ok = value['ok']
        const resultValue = value['value']
        const error = value['error']
        if (typeof id === 'string' && typeof ok === 'boolean') {
            const result: PlaywrightReplHostCallResult = {
                type: 'pwresult',
                id,
                ok,
            }
            if (typeof resultValue === 'string') {
                result.value = resultValue
            }
            if (typeof error === 'string') {
                result.error = error
            }
            return result
        }
    }

    return undefined
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}
