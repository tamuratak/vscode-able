import * as assert from 'node:assert'
import * as path from 'node:path'
import * as readline from 'node:readline'
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { suite, teardown, test } from 'mocha'

interface ExecRequest {
    type: 'exec'
    id: string
    code: string
    timeoutms: number
}

interface ResetRequest {
    type: 'reset'
    id: string
}

type HostToKernelMessage = ExecRequest | ResetRequest

interface ExecResult {
    type: 'result'
    id: string
    ok: boolean
    value?: string
    error?: string
    logs: readonly string[]
}

interface PwCallRequest {
    type: 'pwcall'
    id: string
    method: string
    args: readonly string[]
}

interface PwCallResult {
    type: 'pwresult'
    id: string
    ok: boolean
    value?: string
    error?: string
}

// eslint-disable-next-line
suite('playwright repl kernel runtime guards', function () {
    const children: ChildProcessWithoutNullStreams[] = []
    // eslint-disable-next-line
    this.timeout(20000)

    teardown(() => {
        for (const child of children) {
            if (!child.killed) {
                try {
                    child.kill('SIGKILL')
                } catch {
                    // ignore kill failures
                }
            }
        }
        children.length = 0
    })

    test('reports timeout for long running synchronous code', async () => {
        const harness = createKernelHarness(children)
        const result = await harness.exec('while (true) {}', 50)
        assert.strictEqual(result.ok, false)
        assert.ok(result.error)
        assert.match(result.error, /timed out/i)
    })

    test('applies timeout to microtasks with afterEvaluate mode', async () => {
        const harness = createKernelHarness(children)
        const result = await harness.exec([
            'Promise.resolve().then(() => {',
            '  while (true) {}',
            '})',
            "return 'done'",
        ].join('\n'), 50)
        assert.strictEqual(result.ok, false)
        assert.ok(result.error)
        assert.match(result.error, /timed out/i)
    })

    test('supports top level await style code execution', async () => {
        const harness = createKernelHarness(children)
        const result = await harness.exec([
            "const value = await Promise.resolve('ok')",
            'return value',
        ].join('\n'), 200)

        assert.strictEqual(result.ok, true)
        assert.strictEqual(result.value, 'ok')
    })

    test('captures top level await rejection as error result', async () => {
        const harness = createKernelHarness(children)
        const result = await harness.exec("await Promise.reject(new Error('boom'))", 200)

        assert.strictEqual(result.ok, false)
        assert.ok(result.error)
        assert.match(result.error, /boom/i)
    })

    test('hides require process module Buffer and queue APIs from global scope', async () => {
        const harness = createKernelHarness(children)
        const result = await harness.exec([
            'return JSON.stringify({',
            '  require: typeof require,',
            '  process: typeof process,',
            '  module: typeof module,',
            '  Buffer: typeof Buffer,',
            '  queueMicrotask: typeof queueMicrotask,',
            '  setTimeout: typeof setTimeout,',
            '  setInterval: typeof setInterval,',
            '  setImmediate: typeof setImmediate',
            '})',
        ].join('\n'), 200)

        assert.strictEqual(result.ok, true)
        assert.strictEqual(result.value, JSON.stringify({
            require: 'undefined',
            process: 'undefined',
            module: 'undefined',
            Buffer: 'undefined',
            queueMicrotask: 'undefined',
            setTimeout: 'undefined',
            setInterval: 'undefined',
            setImmediate: 'undefined',
        }))
    })

    test('rejects dynamic import at runtime via import linker', async () => {
        const harness = createKernelHarness(children)
        const result = await harness.exec("await import('node:fs')", 200)
        assert.strictEqual(result.ok, false)
        assert.ok(result.error)
        assert.match(result.error, /import is disabled in playwright repl/i)
    })

    test('ignores non json protocol pollution and continues processing next exec', async () => {
        const harness = createKernelHarness(children)
        harness.sendRawLine('this is not json')

        const result = await harness.exec("return 'ok'", 200)
        assert.strictEqual(result.ok, true)
        assert.strictEqual(result.value, 'ok')
    })

    test('reinitializes runtime state after reset', async () => {
        const harness = createKernelHarness(children)
        const beforeReset = await harness.exec([
            'globalThis.persistedValue = 42',
            'return String(globalThis.persistedValue)',
        ].join('\n'), 200)
        assert.strictEqual(beforeReset.ok, true)
        assert.strictEqual(beforeReset.value, '42')

        const resetResult = await harness.reset()
        assert.strictEqual(resetResult.ok, true)

        const afterReset = await harness.exec('return typeof globalThis.persistedValue', 200)
        assert.strictEqual(afterReset.ok, true)
        assert.strictEqual(afterReset.value, 'undefined')
    })

    test('exposes frozen pw api facade', async () => {
        const harness = createKernelHarness(children)
        const result = await harness.exec([
            'return JSON.stringify({',
            '  pw: Object.isFrozen(pw),',
            '  page: Object.isFrozen(pw.page),',
            '  context: Object.isFrozen(pw.context),',
            '  helpers: Object.isFrozen(pw.helpers)',
            '})',
        ].join('\n'), 200)

        assert.strictEqual(result.ok, true)
        assert.strictEqual(result.value, JSON.stringify({
            pw: true,
            page: true,
            context: true,
            helpers: true,
        }))
    })

    test('keeps page state across multiple exec calls', async () => {
        const harness = createKernelHarness(children)

        const first = await harness.exec("await pw.page.goto('https://example.com/first')\nreturn 'ok'", 200)
        assert.strictEqual(first.ok, true)
        assert.strictEqual(first.value, 'ok')

        const second = await harness.exec('return await pw.page.url()', 200)
        assert.strictEqual(second.ok, true)
        assert.strictEqual(second.value, 'https://example.com/first')
    })

    test('keeps page handle usable after a failed cell', async () => {
        const harness = createKernelHarness(children)

        const prepare = await harness.exec("await pw.page.goto('https://example.com/stable')\nreturn 'ready'", 200)
        assert.strictEqual(prepare.ok, true)

        const failed = await harness.exec("throw new Error('intentional failure')", 200)
        assert.strictEqual(failed.ok, false)

        const after = await harness.exec('return await pw.page.url()', 200)
        assert.strictEqual(after.ok, true)
        assert.strictEqual(after.value, 'https://example.com/stable')
    })

    test('supports multiple screenshot calls in a single cell', async () => {
        const harness = createKernelHarness(children)

        const result = await harness.exec([
            "const first = await pw.page.screenshot('png')",
            "const second = await pw.page.screenshot('jpeg')",
            'return `${first}|${second}`',
        ].join('\n'), 200)

        assert.strictEqual(result.ok, true)
        assert.strictEqual(result.value, 'captured image/png (16 bytes)|captured image/jpeg (16 bytes)')
    })
})

function createKernelHarness(children: ChildProcessWithoutNullStreams[]): {
    exec: (code: string, timeoutms?: number) => Promise<ExecResult>
    reset: () => Promise<ExecResult>
    sendRawLine: (line: string) => void
} {
    const kernelPath = path.resolve(__dirname, '../../../src/playwright_repl/kernel.js')
    const child = spawn(process.execPath, [kernelPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
    })
    children.push(child)

    const pending = new Map<string, {
        resolve:(result: ExecResult) => void
        reject: (error: Error) => void
    }>()

    const lineReader = readline.createInterface({
        input: child.stdout,
        crlfDelay: Infinity,
    })

    const state = {
        currentUrl: 'about:blank',
    }

    lineReader.on('line', (line) => {
        const parsed = parseKernelMessage(line)
        if (!parsed) {
            return
        }
        if (parsed.type === 'pwcall') {
            const response = handlePwCall(parsed, state)
            child.stdin.write(`${JSON.stringify(response)}\n`)
            return
        }

        const waiter = pending.get(parsed.id)
        if (!waiter) {
            return
        }
        pending.delete(parsed.id)
        waiter.resolve(parsed)
    })

    child.on('exit', () => {
        for (const waiter of pending.values()) {
            waiter.reject(new Error('kernel exited unexpectedly'))
        }
        pending.clear()
    })

    let sequence = 0

    const request = async (message: HostToKernelMessage): Promise<ExecResult> => {
        const resultPromise = new Promise<ExecResult>((resolve, reject) => {
            pending.set(message.id, { resolve, reject })
            child.stdin.write(`${JSON.stringify(message)}\n`)
        })

        const timeoutPromise = new Promise<ExecResult>((_resolve, reject) => {
            const waitTimeoutMs = message.type === 'exec'
                ? Math.max(10000, message.timeoutms + 5000)
                : 10000
            const timer = setTimeout(() => {
                pending.delete(message.id)
                reject(new Error(`timed out waiting kernel result: ${message.id}`))
            }, waitTimeoutMs)
            resultPromise.finally(() => {
                clearTimeout(timer)
            }).catch(() => {
                clearTimeout(timer)
            })
        })

        return Promise.race([resultPromise, timeoutPromise])
    }

    return {
        exec: (code: string, timeoutms = 1000) => {
            const id = `exec-${String(sequence)}`
            sequence += 1
            return request({
                type: 'exec',
                id,
                code,
                timeoutms,
            })
        },
        reset: () => {
            const id = `reset-${String(sequence)}`
            sequence += 1
            return request({
                type: 'reset',
                id,
            })
        },
        sendRawLine: (line: string) => {
            child.stdin.write(`${line}\n`)
        },
    }
}

function parseKernelMessage(line: string): ExecResult | PwCallRequest | undefined {
    try {
        const parsed = JSON.parse(line) as Record<string, unknown>
        const type = parsed['type']

        if (type === 'pwcall') {
            const id = parsed['id']
            const method = parsed['method']
            const args = parsed['args']

            if (typeof id !== 'string' || typeof method !== 'string' || !isStringArray(args)) {
                return undefined
            }

            return {
                type: 'pwcall',
                id,
                method,
                args,
            }
        }

        const id = parsed['id']
        const ok = parsed['ok']
        const logs = parsed['logs']
        const value = parsed['value']
        const error = parsed['error']

        if (type !== 'result') {
            return undefined
        }
        if (typeof id !== 'string' || typeof ok !== 'boolean' || !isStringArray(logs)) {
            return undefined
        }

        const result: ExecResult = {
            type: 'result',
            id,
            ok,
            logs,
        }
        if (typeof value === 'string') {
            result.value = value
        }
        if (typeof error === 'string') {
            result.error = error
        }

        return result
    } catch {
        return undefined
    }
}

function handlePwCall(request: PwCallRequest, state: { currentUrl: string }): PwCallResult {
    if (request.method === 'page.goto') {
        const [url] = request.args
        state.currentUrl = url
        return {
            type: 'pwresult',
            id: request.id,
            ok: true,
            value: state.currentUrl,
        }
    }

    if (request.method === 'page.url') {
        return {
            type: 'pwresult',
            id: request.id,
            ok: true,
            value: state.currentUrl,
        }
    }

    if (request.method === 'page.screenshot') {
        const [format] = request.args
        const mimetype = format === 'jpeg' ? 'image/jpeg' : 'image/png'
        return {
            type: 'pwresult',
            id: request.id,
            ok: true,
            value: `captured ${mimetype} (16 bytes)`,
        }
    }

    return {
        type: 'pwresult',
        id: request.id,
        ok: false,
        error: `unsupported method in test harness: ${request.method}`,
    }
}

function isStringArray(value: unknown): value is string[] {
    if (!Array.isArray(value)) {
        return false
    }
    for (const item of value) {
        if (typeof item !== 'string') {
            return false
        }
    }
    return true
}
