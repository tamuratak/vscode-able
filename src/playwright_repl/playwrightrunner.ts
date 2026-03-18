import { createInterface } from 'node:readline'
import { inspect } from 'node:util'
import { VM } from 'vm2'
import { chromium, firefox, webkit, Browser, BrowserContext, Page } from 'playwright'
import { validatePlaywrightReplCode } from './codevalidator.js'
import { ExecRequest, RequestMessage, RunnerConfig, parseRunnerMessage } from './runnermessage.js'

type ImageFormat = 'jpeg' | 'png'

interface ImagePayload {
    mimeType: string
    base64: string
    meta: string
    text: string
}

interface RunnerResult {
    id: string
    ok: boolean
    stdout: string
    stderr: string
    result?: string
    images?: ImagePayload[]
    error?: {
        name: string
        message: string
        stack?: string
    }
}

const defaultConfig: RunnerConfig = {
    browserType: 'chromium',
    headless: true
}

const executionTimeoutMs = 15000
const maxOutputBytes = 16384
const maxScreenshotBytes = 1024 * 1024

const localHosts = new Set<string>([
    'localhost',
    '127.0.0.1',
    '::1',
    '[::1]'
])

const allowedSchemes = new Set<string>([
    'http:',
    'https:'
])

const minAllowedPort = 3000
const maxAllowedPort = 3010

function isLocalHost(host: string): boolean {
    return localHosts.has(host.trim().toLowerCase())
}

function isAllowedPort(portText: string): boolean {
    if (portText.length === 0) {
        return false
    }
    const portNumber = Number(portText)
    if (!Number.isInteger(portNumber)) {
        return false
    }
    return portNumber >= minAllowedPort && portNumber <= maxAllowedPort
}

class RunnerState {
    private browser: Browser | undefined
    private context: BrowserContext | undefined
    private page: Page | undefined
    private config: RunnerConfig = { ...defaultConfig }

    setConfig(config: RunnerConfig) {
        this.config = { ...config }
    }

    async reset() {
        await this.dispose()
    }

    async dispose() {
        if (this.page) {
            await this.page.close().catch(() => undefined)
            this.page = undefined
        }
        if (this.context) {
            await this.context.close().catch(() => undefined)
            this.context = undefined
        }
        if (this.browser) {
            await this.browser.close().catch(() => undefined)
            this.browser = undefined
        }
    }

    getTimeoutMs(): number {
        return executionTimeoutMs
    }

    async createPwApi(stdout: string[], stderr: string[], images: ImagePayload[]): Promise<Record<string, unknown>> {
        const screenshotCounter = {
            count: 0,
            limit: 3
        }

        const page = await this.ensurePage()

        const pwApi = {
            page,
            screenshot: async (options?: { format?: ImageFormat, quality?: number, fullPage?: boolean, clip?: { x: number, y: number, width: number, height: number } }) => {
                screenshotCounter.count += 1
                if (screenshotCounter.count > screenshotCounter.limit) {
                    throw new Error('too many screenshots in one exec')
                }

                const format = options?.format ?? 'jpeg'
                const quality = format === 'jpeg' ? (options?.quality ?? 85) : undefined
                const screenshotOptions: {
                    type: ImageFormat
                    scale: 'css'
                    quality?: number
                    fullPage?: boolean
                    clip?: { x: number, y: number, width: number, height: number }
                } = {
                    type: format,
                    scale: 'css'
                }
                if (quality !== undefined) {
                    screenshotOptions.quality = quality
                }
                if (options?.fullPage !== undefined) {
                    screenshotOptions.fullPage = options.fullPage
                }
                if (options?.clip !== undefined) {
                    screenshotOptions.clip = options.clip
                }

                const screenshot = await page.screenshot(screenshotOptions)

                if (screenshot.byteLength > maxScreenshotBytes) {
                    throw new Error(`screenshot exceeds max bytes: ${screenshot.byteLength}`)
                }

                const viewport = page.viewportSize()
                const dimensions = await page.evaluate(() => {
                    return {
                        cssWidth: window.innerWidth,
                        cssHeight: window.innerHeight,
                        deviceScaleFactor: window.devicePixelRatio
                    }
                })

                const meta = {
                    width: viewport?.width ?? dimensions.cssWidth,
                    height: viewport?.height ?? dimensions.cssHeight,
                    cssWidth: dimensions.cssWidth,
                    cssHeight: dimensions.cssHeight,
                    deviceScaleFactor: dimensions.deviceScaleFactor,
                    clipped: !!options?.clip,
                    clipRect: options?.clip
                }

                const mimeType = format === 'png' ? 'image/png' : 'image/jpeg'
                const imagePayload: ImagePayload = {
                    mimeType,
                    base64: screenshot.toString('base64'),
                    meta: JSON.stringify(meta),
                    text: `Screenshot captured from ${page.url()}`
                }
                images.push(imagePayload)

                return {
                    text: imagePayload.text,
                    meta
                }
            }
        }

        const toLine = (values: unknown[]) => values.map(value => String(value)).join(' ')
        const sandboxConsole = {
            log: (...values: unknown[]) => pushLimited(stdout, toLine(values), maxOutputBytes),
            info: (...values: unknown[]) => pushLimited(stdout, toLine(values), maxOutputBytes),
            warn: (...values: unknown[]) => pushLimited(stderr, toLine(values), maxOutputBytes),
            error: (...values: unknown[]) => pushLimited(stderr, toLine(values), maxOutputBytes)
        }

        return {
            pwApi,
            console: sandboxConsole,
            setTimeout,
            clearTimeout,
            URL
        }
    }

    private async ensurePage(): Promise<Page> {
        if (!this.browser) {
            if (this.config.browserType === 'firefox') {
                this.browser = await firefox.launch({ headless: this.config.headless })
            } else if (this.config.browserType === 'webkit') {
                this.browser = await webkit.launch({ headless: this.config.headless })
            } else {
                this.browser = await chromium.launch({ headless: this.config.headless })
            }
        }

        if (!this.context) {
            this.context = await this.browser.newContext()
            await this.context.route('**/*', (route) => {
                const requestUrl = route.request().url()
                if (isAllowedUrl(requestUrl)) {
                    return route.continue()
                }
                return route.abort('blockedbyclient')
            })
        }

        if (!this.page) {
            this.page = await this.context.newPage()
        }

        return this.page
    }

}

const state = new RunnerState()

function pushLimited(target: string[], value: string, maxBytes: number) {
    const content = target.join('\n')
    const remaining = maxBytes - Buffer.byteLength(content, 'utf8')
    if (remaining <= 0) {
        return
    }
    const trimmed = trimUtf8(value, remaining)
    if (trimmed.length > 0) {
        target.push(trimmed)
    }
}

function trimUtf8(value: string, maxBytes: number): string {
    const buffer = Buffer.from(value, 'utf8')
    if (buffer.byteLength <= maxBytes) {
        return value
    }
    return buffer.subarray(0, Math.max(0, maxBytes)).toString('utf8')
}

export function isAllowedUrl(url: string): boolean {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return false
    }

    if (!allowedSchemes.has(parsed.protocol)) {
        return false
    }

    const host = parsed.hostname.toLowerCase()
    if (!isLocalHost(host)) {
        return false
    }

    return isAllowedPort(parsed.port)
}

async function handleExec(request: ExecRequest): Promise<RunnerResult> {
    const stdout: string[] = []
    const stderr: string[] = []
    const images: ImagePayload[] = []

    try {
        const validationResult = await validatePlaywrightReplCode(request.code)
        if (!validationResult.ok) {
            throw new Error(`validation failed: ${validationResult.reason}`)
        }

        const sandbox = await state.createPwApi(stdout, stderr, images)
        const timeoutMs = state.getTimeoutMs()
        const vm = new VM({
            timeout: timeoutMs,
            allowAsync: true,
            eval: false,
            wasm: false,
            sandbox
        })

        const wrappedCode = `(async () => {\n${request.code}\n})()`
        const execResult: unknown = await vm.run(wrappedCode)
        return {
            id: request.id,
            ok: true,
            stdout: stdout.join('\n'),
            stderr: stderr.join('\n'),
            result: stringifyResult(execResult),
            images
        }
    } catch (error) {
        if (error instanceof Error) {
            const stack = typeof error.stack === 'string' ? error.stack : undefined
            return {
                id: request.id,
                ok: false,
                stdout: stdout.join('\n'),
                stderr: stderr.join('\n'),
                error: {
                    name: error.name,
                    message: error.message,
                    ...(stack ? { stack } : {})
                }
            }
        }

        return {
            id: request.id,
            ok: false,
            stdout: stdout.join('\n'),
            stderr: stderr.join('\n'),
            error: {
                name: 'Error',
                message: 'unknown error'
            }
        }
    }
}

function stringifyResult(value: unknown): string {
    if (typeof value === 'string') {
        return value
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return inspect(value, { depth: 4, breakLength: 120 })
    }
    if (value === undefined) {
        return 'undefined'
    }
    try {
        return JSON.stringify(value)
    } catch {
        return '[unserializable result]'
    }
}

async function handleMessage(request: RequestMessage): Promise<RunnerResult> {
    if (request.type === 'init') {
        state.setConfig(request.config)
        return {
            id: request.id,
            ok: true,
            stdout: '',
            stderr: '',
            result: 'initialized'
        }
    }

    if (request.type === 'exec') {
        return handleExec(request)
    }

    if (request.type === 'reset') {
        await state.reset()
        return {
            id: request.id,
            ok: true,
            stdout: '',
            stderr: '',
            result: 'reset'
        }
    }

    await state.dispose()
    return {
        id: request.id,
        ok: true,
        stdout: '',
        stderr: '',
        result: 'disposed'
    }
}

function writeResponse(response: RunnerResult) {
    process.stdout.write(`${JSON.stringify(response)}\n`)
}

function parseMessage(line: string): RequestMessage | undefined {
    return parseRunnerMessage(line, defaultConfig)
}

const readlineInterface = createInterface({
    input: process.stdin,
    crlfDelay: Infinity
})

readlineInterface.on('line', async (line) => {
    const message = parseMessage(line)
    if (!message) {
        writeResponse({
            id: 'unknown',
            ok: false,
            stdout: '',
            stderr: '',
            error: {
                name: 'Error',
                message: 'invalid message'
            }
        })
        return
    }

    const response = await handleMessage(message)
    writeResponse(response)

    if (message.type === 'dispose') {
        readlineInterface.close()
        process.exit(0)
    }
})

readlineInterface.on('close', async () => {
    await state.dispose()
})
