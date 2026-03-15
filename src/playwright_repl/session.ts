import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import * as path from 'node:path'
import * as readline from 'node:readline'
import { Browser, BrowserContext, chromium, firefox, LaunchOptions, Page, webkit } from 'playwright'
import { LogOutputChannel } from 'vscode'
import { PlaywrightReplExecRequest, PlaywrightReplExecResult, PlaywrightReplHostCallRequest, PlaywrightReplHostCallResult, PlaywrightReplHostToKernelMessage, PlaywrightReplKernelToHostMessage, PlaywrightReplResetRequest, PlaywrightReplScreenshot } from './protocol.js'

interface PendingExecution {
    resolve: (result: PlaywrightReplExecResult) => void
    reject: (error: Error) => void
}

export interface PlaywrightReplRuntimeConfig {
    readonly browser: 'chromium' | 'firefox' | 'webkit'
    readonly channel: string | undefined
    readonly headless: boolean
    readonly executablepath: string | undefined
    readonly timeoutms: number
    readonly screenshotmaxbytes: number
    readonly screenshottotalmaxbytes: number
}

export interface PlaywrightReplExecutionResult {
    readonly ok: boolean
    readonly value: string
    readonly logs: readonly string[]
    readonly screenshots: readonly PlaywrightReplScreenshot[]
}

export class PlaywrightReplSession {
    private child: ChildProcessWithoutNullStreams | undefined
    private browser: Browser | undefined
    private context: BrowserContext | undefined
    private page: Page | undefined
    private sequence = 0
    private readonly pendingExecutions = new Map<string, PendingExecution>()
    private currentExecutionScreenshots: PlaywrightReplScreenshot[] = []
    private currentExecutionScreenshotBytes = 0

    constructor(
        private readonly outputChannel: LogOutputChannel,
        private readonly readRuntimeConfig: () => PlaywrightReplRuntimeConfig,
    ) { }

    async exec(code: string, timeoutOverrideMs: number | undefined): Promise<PlaywrightReplExecutionResult> {
        const runtimeConfig = this.readRuntimeConfig()
        this.ensureChild()
        await this.ensurePlaywrightReady(runtimeConfig)

        const timeoutms = timeoutOverrideMs ?? runtimeConfig.timeoutms

        const id = this.nextId('exec')
        const request: PlaywrightReplExecRequest = {
            type: 'exec',
            id,
            code,
            timeoutms,
        }

        this.currentExecutionScreenshots = []
        this.currentExecutionScreenshotBytes = 0

        const result = await this.waitExecutionResult(request, timeoutms)

        if (!result.ok) {
            throw new Error(result.error ?? 'playwright repl execution failed')
        }

        return {
            ok: result.ok,
            value: result.value ?? 'undefined',
            logs: result.logs,
            screenshots: [...this.currentExecutionScreenshots],
        }
    }

    async reset(): Promise<void> {
        await this.disposePlaywrightHandles()
        this.ensureChild()

        const id = this.nextId('reset')
        const request: PlaywrightReplResetRequest = {
            type: 'reset',
            id,
        }

        await new Promise<void>((resolve, reject) => {
            this.pendingExecutions.set(id, {
                resolve: (_result) => {
                    resolve()
                },
                reject,
            })
            this.writeLine(request)
        })
    }

    private async waitExecutionResult(request: PlaywrightReplExecRequest, timeoutms: number): Promise<PlaywrightReplExecResult> {
        const waitPromise = new Promise<PlaywrightReplExecResult>((resolve, reject) => {
            this.pendingExecutions.set(request.id, { resolve, reject })
            this.writeLine(request)
        })

        const timeoutPromise = new Promise<PlaywrightReplExecResult>((_resolve, reject) => {
            const timer = setTimeout(() => {
                this.restartKernelAfterTimeout(request.id, timeoutms)
                    reject(new Error(`playwright repl timed out after ${String(timeoutms)}ms`))
            }, timeoutms + 250)
            waitPromise.finally(() => {
                clearTimeout(timer)
            }).catch(() => {
                clearTimeout(timer)
            })
        })

        return Promise.race([waitPromise, timeoutPromise])
    }

    private restartKernelAfterTimeout(requestId: string, timeoutms: number): void {
        this.outputChannel.warn(`[PlaywrightReplSession]: timeout detected for ${requestId}, restarting kernel`)
        this.killChildProcess()
        this.child = undefined

        const pending = this.pendingExecutions.get(requestId)
        if (pending) {
            this.pendingExecutions.delete(requestId)
            pending.reject(new Error(`playwright repl timed out after ${String(timeoutms)}ms`))
        }
        this.ensureChild()
    }

    private ensureChild(): void {
        if (this.child) {
            return
        }

        const kernelPath = path.join(__dirname, 'kernel.js')
        const child = spawn(process.execPath, [kernelPath], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: process.cwd(),
        })
        this.child = child

        const stdoutLineReader = readline.createInterface({
            input: child.stdout,
            crlfDelay: Infinity,
        })
        stdoutLineReader.on('line', (line) => {
            void this.onKernelStdoutLine(line)
        })

        child.stderr.setEncoding('utf8')
        child.stderr.on('data', (chunk: string) => {
            this.outputChannel.warn(`[PlaywrightReplSession:kernel stderr] ${chunk}`)
        })

        child.on('exit', (code, signal) => {
            this.outputChannel.warn(`[PlaywrightReplSession]: kernel exited code=${String(code)} signal=${String(signal)}`)
            this.child = undefined
            for (const pending of this.pendingExecutions.values()) {
                pending.reject(new Error('playwright repl kernel exited unexpectedly'))
            }
            this.pendingExecutions.clear()
        })
    }

    private async ensurePlaywrightReady(runtimeConfig: PlaywrightReplRuntimeConfig): Promise<void> {
        if (!this.browser) {
            const browserType = runtimeConfig.browser === 'firefox'
                ? firefox
                : runtimeConfig.browser === 'webkit'
                    ? webkit
                    : chromium

            const launchOptions: LaunchOptions = {
                headless: runtimeConfig.headless,
            }
            if (runtimeConfig.channel) {
                launchOptions.channel = runtimeConfig.channel
            }
            if (runtimeConfig.executablepath) {
                launchOptions.executablePath = runtimeConfig.executablepath
            }

            this.browser = await browserType.launch(launchOptions)
        }

        if (!this.context) {
            this.context = await this.browser.newContext()
        }

        if (!this.page) {
            this.page = await this.context.newPage()
        }
    }

    private async disposePlaywrightHandles(): Promise<void> {
        if (this.page) {
            await this.page.close()
            this.page = undefined
        }
        if (this.context) {
            await this.context.close()
            this.context = undefined
        }
        if (this.browser) {
            await this.browser.close()
            this.browser = undefined
        }
    }

    private async onKernelStdoutLine(line: string): Promise<void> {
        const message = this.parseKernelMessage(line)
        if (!message) {
            this.outputChannel.warn(`[PlaywrightReplSession]: ignored non protocol line: ${line}`)
            return
        }

        if (message.type === 'pwcall') {
            await this.handlePwCall(message)
            return
        }

        const pending = this.pendingExecutions.get(message.id)
        if (!pending) {
            return
        }

        this.pendingExecutions.delete(message.id)
        if (message.ok) {
            pending.resolve(message)
            return
        }
        pending.reject(new Error(message.error ?? 'playwright repl execution failed'))
    }

    private async handlePwCall(request: PlaywrightReplHostCallRequest): Promise<void> {
        const response = await this.executePwCall(request)
        this.writeLine(response)
    }

    private async executePwCall(request: PlaywrightReplHostCallRequest): Promise<PlaywrightReplHostCallResult> {
        try {
            const page = this.page
            const context = this.context
            if (!page || !context) {
                throw new Error('playwright is not initialized')
            }

            const value = await this.dispatchPwCall(request, page, context)
            return {
                type: 'pwresult',
                id: request.id,
                ok: true,
                value,
            }
        } catch (error) {
            return {
                type: 'pwresult',
                id: request.id,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
            }
        }
    }

    private async dispatchPwCall(request: PlaywrightReplHostCallRequest, page: Page, context: BrowserContext): Promise<string> {
        const runtimeConfig = this.readRuntimeConfig()
        switch (request.method) {
            case 'page.goto': {
                const [url] = request.args
                await page.goto(url)
                return page.url()
            }
            case 'page.click': {
                const [selector] = request.args
                await page.click(selector)
                return 'ok'
            }
            case 'page.fill': {
                const [selector, value] = request.args
                await page.fill(selector, value)
                return 'ok'
            }
            case 'page.title': {
                return page.title()
            }
            case 'page.url': {
                return page.url()
            }
            case 'page.content': {
                return page.content()
            }
            case 'page.textcontent': {
                const [selector] = request.args
                const text = await page.textContent(selector)
                return text ?? ''
            }
            case 'context.cookies': {
                const cookies = await context.cookies()
                return JSON.stringify(cookies)
            }
            case 'page.screenshot': {
                const [format] = request.args
                if (format !== 'png' && format !== 'jpeg') {
                    throw new Error('page.screenshot supports only png and jpeg')
                }

                const data = await page.screenshot({
                    type: format,
                })
                const bytes = data.byteLength
                if (bytes > runtimeConfig.screenshotmaxbytes) {
                    throw new Error(`screenshot too large: ${String(bytes)} bytes`)
                }

                const totalBytes = this.currentExecutionScreenshotBytes + bytes
                if (totalBytes > runtimeConfig.screenshottotalmaxbytes) {
                    throw new Error(`total screenshot bytes exceeded: ${String(totalBytes)} bytes`)
                }

                const mimetype = format === 'png' ? 'image/png' : 'image/jpeg'
                this.currentExecutionScreenshots.push({
                    mimetype,
                    data: data.toString('base64'),
                    bytes,
                })
                this.currentExecutionScreenshotBytes = totalBytes
                return `captured ${mimetype} (${String(bytes)} bytes)`
            }
            default: {
                throw new Error(`unsupported pw method: ${request.method}`)
            }
        }
    }

    private killChildProcess(): void {
        const child = this.child
        if (!child) {
            return
        }
        if (child.pid) {
            try {
                process.kill(child.pid, 'SIGKILL')
                return
            } catch {
                // ignore and fallback
            }
        }
        try {
            child.kill('SIGKILL')
        } catch {
            // ignore
        }
    }

    private parseKernelMessage(line: string): PlaywrightReplKernelToHostMessage | undefined {
        try {
            const parsed = JSON.parse(line) as Record<string, unknown>
            return this.toKernelMessage(parsed)
        } catch {
            return undefined
        }
    }

    private writeLine(message: PlaywrightReplHostToKernelMessage): void {
        const child = this.child
        if (!child) {
            throw new Error('playwright repl kernel is not available')
        }
        child.stdin.write(`${JSON.stringify(message)}\n`)
    }

    private nextId(prefix: string): string {
        const id = `${prefix}-${this.sequence}`
        this.sequence += 1
        return id
    }

    private toKernelMessage(value: unknown): PlaywrightReplKernelToHostMessage | undefined {
        if (!this.isRecord(value)) {
            return undefined
        }

        const type = value['type']
        if (type === 'pwcall') {
            const id = value['id']
            const method = value['method']
            const args = value['args']
            if (typeof id === 'string' && typeof method === 'string' && this.isStringArray(args)) {
                return {
                    type: 'pwcall',
                    id,
                    method,
                    args,
                }
            }
            return undefined
        }

        if (type === 'result') {
            const id = value['id']
            const ok = value['ok']
            const resultValue = value['value']
            const error = value['error']
            const logs = value['logs']
            if (typeof id === 'string' && typeof ok === 'boolean' && this.isStringArray(logs)) {
                const result: PlaywrightReplExecResult = {
                    type: 'result',
                    id,
                    ok,
                    logs,
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

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null
    }

    private isStringArray(value: unknown): value is string[] {
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
}
