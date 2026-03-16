import { createInterface } from 'node:readline'
import { inspect } from 'node:util'
import { VM } from 'vm2'
import { chromium, firefox, webkit, Browser, BrowserContext, Page } from 'playwright'
import { validatePlaywrightReplCode } from './codevalidator.js'

type BrowserTypeName = 'chromium' | 'firefox' | 'webkit'
type ImageFormat = 'jpeg' | 'png'

interface RunnerConfig {
    browserType: BrowserTypeName
    headless: boolean
    networkAllow: boolean
    allowedHosts: string[]
    timeoutMs: number
    maxOutputBytes: number
    maxScreenshotBytes: number
    screenshotDefaultFormat: ImageFormat
}

interface ExecRequest {
    id: string
    type: 'exec'
    code: string
    timeoutMs?: number
}

interface ResetRequest {
    id: string
    type: 'reset'
}

interface DisposeRequest {
    id: string
    type: 'dispose'
}

interface InitRequest {
    id: string
    type: 'init'
    config: RunnerConfig
}

type RequestMessage = ExecRequest | ResetRequest | DisposeRequest | InitRequest

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

interface RoleOptions {
    name?: string
    exact?: boolean
}

interface LocatorProxy {
    click(): Promise<void>
    fill(value: string): Promise<void>
    text(): Promise<string>
}

const defaultConfig: RunnerConfig = {
    browserType: 'chromium',
    headless: true,
    networkAllow: false,
    allowedHosts: [],
    timeoutMs: 15000,
    maxOutputBytes: 16384,
    maxScreenshotBytes: 1024 * 1024,
    screenshotDefaultFormat: 'jpeg'
}

class RunnerState {
    private browser: Browser | undefined
    private context: BrowserContext | undefined
    private page: Page | undefined
    private config: RunnerConfig = { ...defaultConfig }

    setConfig(config: RunnerConfig) {
        this.config = {
            ...config,
            allowedHosts: normalizeAllowedHosts(config.allowedHosts)
        }
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

    getTimeoutMs(overrideTimeoutMs: number | undefined): number {
        if (typeof overrideTimeoutMs === 'number' && Number.isFinite(overrideTimeoutMs)) {
            return Math.max(500, Math.min(overrideTimeoutMs, 120000))
        }
        return Math.max(500, Math.min(this.config.timeoutMs, 120000))
    }

    createPwApi(stdout: string[], stderr: string[], images: ImagePayload[]): Record<string, unknown> {
        const screenshotCounter = {
            count: 0,
            limit: 3
        }

        const pwApi = {
            goto: async (url: string) => {
                const page = await this.ensurePage()
                await page.goto(url)
                return page.url()
            },
            click: async (selector: string) => {
                const page = await this.ensurePage()
                await page.click(selector)
            },
            fill: async (selector: string, value: string) => {
                const page = await this.ensurePage()
                await page.fill(selector, value)
            },
            text: async (selector: string) => {
                const page = await this.ensurePage()
                const value = await page.textContent(selector)
                return value ?? ''
            },
            locator: (selector: string): LocatorProxy => {
                const getLocator = async () => {
                    const page = await this.ensurePage()
                    return page.locator(selector)
                }
                return {
                    click: async () => {
                        const locator = await getLocator()
                        await locator.click()
                    },
                    fill: async (value: string) => {
                        const locator = await getLocator()
                        await locator.fill(value)
                    },
                    text: async () => {
                        const locator = await getLocator()
                        const value = await locator.textContent()
                        return value ?? ''
                    }
                }
            },
            getByRole: (role: string, options?: RoleOptions): LocatorProxy => {
                const getLocator = async () => {
                    const page = await this.ensurePage()
                    return page.getByRole(role as never, options)
                }
                return {
                    click: async () => {
                        const locator = await getLocator()
                        await locator.click()
                    },
                    fill: async (value: string) => {
                        const locator = await getLocator()
                        await locator.fill(value)
                    },
                    text: async () => {
                        const locator = await getLocator()
                        const value = await locator.textContent()
                        return value ?? ''
                    }
                }
            },
            screenshot: async (options?: { format?: ImageFormat, quality?: number, fullPage?: boolean, clip?: { x: number, y: number, width: number, height: number } }) => {
                screenshotCounter.count += 1
                if (screenshotCounter.count > screenshotCounter.limit) {
                    throw new Error('too many screenshots in one exec')
                }

                const page = await this.ensurePage()
                const format = options?.format ?? this.config.screenshotDefaultFormat
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

                if (screenshot.byteLength > this.config.maxScreenshotBytes) {
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
            },
            url: async () => {
                const page = await this.ensurePage()
                return page.url()
            }
        }

        const toLine = (values: unknown[]) => values.map(value => String(value)).join(' ')
        const sandboxConsole = {
            log: (...values: unknown[]) => pushLimited(stdout, toLine(values), this.config.maxOutputBytes),
            info: (...values: unknown[]) => pushLimited(stdout, toLine(values), this.config.maxOutputBytes),
            warn: (...values: unknown[]) => pushLimited(stderr, toLine(values), this.config.maxOutputBytes),
            error: (...values: unknown[]) => pushLimited(stderr, toLine(values), this.config.maxOutputBytes)
        }

        return {
            pw: pwApi,
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
                if (isAllowedUrl(requestUrl, this.config.networkAllow, this.config.allowedHosts)) {
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

export function normalizeAllowedHosts(hosts: string[]): string[] {
    const values = new Set<string>()
    for (const host of hosts) {
        const normalized = host.trim().toLowerCase()
        if (normalized.length > 0) {
            values.add(normalized)
        }
    }
    values.add('localhost')
    values.add('127.0.0.1')
    values.add('::1')
    return [...values]
}

export function isAllowedUrl(url: string, networkAllow: boolean, allowedHosts: string[]): boolean {
    let parsed: URL
    try {
        parsed = new URL(url)
    } catch {
        return false
    }

    if (parsed.protocol === 'about:' || parsed.protocol === 'data:') {
        return true
    }

    const host = parsed.hostname.toLowerCase()
    const normalizedHosts = normalizeAllowedHosts(allowedHosts)

    if (!networkAllow) {
        return normalizedHosts.includes(host)
    }

    if (allowedHosts.length === 0) {
        return true
    }

    return normalizedHosts.includes(host)
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

        const sandbox = state.createPwApi(stdout, stderr, images)
        const timeoutMs = state.getTimeoutMs(request.timeoutMs)
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
    try {
        const parsed: unknown = JSON.parse(line)
        if (!isRecord(parsed)) {
            return undefined
        }
        const id = getString(parsed, 'id')
        const type = getString(parsed, 'type')
        if (!id || !type) {
            return undefined
        }
        if (type === 'exec') {
            const code = getString(parsed, 'code')
            if (!code) {
                return undefined
            }
            const timeoutMs = getNumber(parsed, 'timeoutMs')
            return {
                id,
                type: 'exec',
                code,
                ...(timeoutMs !== undefined ? { timeoutMs } : {})
            }
        }
        if (type === 'reset') {
            return {
                id,
                type: 'reset'
            }
        }
        if (type === 'dispose') {
            return {
                id,
                type: 'dispose'
            }
        }
        if (type === 'init') {
            const config = parseRunnerConfig(parsed)
            if (!config) {
                return undefined
            }
            return {
                id,
                type: 'init',
                config
            }
        }
    } catch {
        return undefined
    }
    return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function getString(value: Record<string, unknown>, key: string): string | undefined {
    const field = value[key]
    if (typeof field === 'string') {
        return field
    }
    return undefined
}

function getBoolean(value: Record<string, unknown>, key: string): boolean | undefined {
    const field = value[key]
    if (typeof field === 'boolean') {
        return field
    }
    return undefined
}

function getNumber(value: Record<string, unknown>, key: string): number | undefined {
    const field = value[key]
    if (typeof field === 'number' && Number.isFinite(field)) {
        return field
    }
    return undefined
}

function getStringArray(value: Record<string, unknown>, key: string): string[] | undefined {
    const field = value[key]
    if (!Array.isArray(field)) {
        return undefined
    }
    const values: string[] = []
    for (const element of field) {
        if (typeof element !== 'string') {
            return undefined
        }
        values.push(element)
    }
    return values
}

function parseRunnerConfig(parsed: Record<string, unknown>): RunnerConfig | undefined {
    const configValue = parsed['config']
    if (!isRecord(configValue)) {
        return undefined
    }
    const browserType = getString(configValue, 'browserType')
    const headless = getBoolean(configValue, 'headless')
    const networkAllow = getBoolean(configValue, 'networkAllow')
    const allowedHosts = getStringArray(configValue, 'allowedHosts')
    const timeoutMs = getNumber(configValue, 'timeoutMs')
    const maxOutputBytes = getNumber(configValue, 'maxOutputBytes')
    const maxScreenshotBytes = getNumber(configValue, 'maxScreenshotBytes')
    const screenshotDefaultFormat = getString(configValue, 'screenshotDefaultFormat')

    return {
        browserType: (browserType === 'chromium' || browserType === 'firefox' || browserType === 'webkit') ? browserType : defaultConfig.browserType,
        headless: headless ?? defaultConfig.headless,
        networkAllow: networkAllow ?? defaultConfig.networkAllow,
        allowedHosts: allowedHosts ?? defaultConfig.allowedHosts,
        timeoutMs: timeoutMs ?? defaultConfig.timeoutMs,
        maxOutputBytes: maxOutputBytes ?? defaultConfig.maxOutputBytes,
        maxScreenshotBytes: maxScreenshotBytes ?? defaultConfig.maxScreenshotBytes,
        screenshotDefaultFormat: (screenshotDefaultFormat === 'jpeg' || screenshotDefaultFormat === 'png') ? screenshotDefaultFormat : defaultConfig.screenshotDefaultFormat
    }
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
