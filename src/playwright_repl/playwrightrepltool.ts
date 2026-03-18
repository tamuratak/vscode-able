import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { CancellationToken, LanguageModelDataPart, LanguageModelTextPart, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult, LogOutputChannel } from 'vscode'

interface PlaywrightReplInput {
    code: string
    reason?: string
}

interface PlaywrightReplResetInput {
    reason?: string
}

type BrowserTypeName = 'chromium' | 'firefox' | 'webkit'

interface RunnerConfig {
    browserType: BrowserTypeName
    headless: boolean
}

interface RunnerRequest {
    id: string
    type: 'init' | 'exec' | 'reset' | 'dispose'
    code?: string
    config?: RunnerConfig
}

interface RunnerImagePayload {
    mimeType: string
    base64: string
    meta: string
    text: string
}

interface RunnerResponse {
    id: string
    ok: boolean
    stdout: string
    stderr: string
    result?: string
    images?: RunnerImagePayload[]
    error?: {
        name: string
        message: string
        stack?: string
    }
}

interface PendingRequest {
    resolve: (response: RunnerResponse) => void
    reject: (error: Error) => void
    timeoutHandle: NodeJS.Timeout
}

interface RunnerSession {
    key: string
    process: ChildProcessWithoutNullStreams
    pending: Map<string, PendingRequest>
    buffer: string
    idleTimer: NodeJS.Timeout | undefined
    initialized: boolean
}

const idleMs = 5 * 60 * 1000

export class PlaywrightReplTool implements LanguageModelTool<PlaywrightReplInput> {
    private readonly sessions = new Map<string, RunnerSession>()

    constructor(
        private readonly extension: {
            readonly outputChannel: LogOutputChannel
            readonly extensionUri: vscode.Uri
        }
    ) {
        this.extension.outputChannel.info('[PlaywrightReplTool]: created')
    }

    prepareInvocation(_options: vscode.LanguageModelToolInvocationPrepareOptions<PlaywrightReplInput>) {
        return {
            invocationMessage: 'Execute JavaScript with persistent Playwright session'
        }
    }

    async invoke(options: LanguageModelToolInvocationOptions<PlaywrightReplInput>, token: CancellationToken) {
        if (process.platform !== 'darwin') {
            throw new Error('[PlaywrightReplTool]: This tool requires macOS')
        }

        const code = options.input.code.trim()
        if (code.length === 0) {
            throw new Error('[PlaywrightReplTool]: code is empty')
        }

        const sessionKey = 'default'
        const session = this.getOrCreateSession(sessionKey)
        this.bumpIdleTimer(session)

        await this.ensureSessionInitialized(session)

        const response = await this.sendRequest(session, {
            id: createRequestId('exec'),
            type: 'exec',
            code
        }, token)

        if (!response.ok) {
            const message = response.error?.message ?? 'execution failed'
            throw new Error(`[PlaywrightReplTool]: ${message}`)
        }

        const parts: (LanguageModelTextPart | LanguageModelDataPart)[] = []
        if (response.stdout.length > 0) {
            parts.push(new LanguageModelTextPart(`stdout:\n${response.stdout}`))
        }
        if (response.stderr.length > 0) {
            parts.push(new LanguageModelTextPart(`stderr:\n${response.stderr}`))
        }
        if (response.result && response.result !== 'undefined') {
            parts.push(new LanguageModelTextPart(`result:\n${response.result}`))
        }

        for (const image of response.images ?? []) {
            const bytes = Buffer.from(image.base64, 'base64')
            parts.push(LanguageModelDataPart.image(bytes, image.mimeType))
            parts.push(new LanguageModelTextPart(`${image.text}\nmeta: ${image.meta}`))
        }

        if (parts.length === 0) {
            parts.push(new LanguageModelTextPart('ok'))
        }

        return new LanguageModelToolResult(parts)
    }

    dispose() {
        for (const session of this.sessions.values()) {
            this.disposeSession(session)
        }
        this.sessions.clear()
    }

    private getOrCreateSession(key: string): RunnerSession {
        const existing = this.sessions.get(key)
        if (existing) {
            return existing
        }

        const runnerPath = path.join(this.extension.extensionUri.fsPath, 'out', 'src', 'playwright_repl', 'playwrightrunner.js')
        const child = spawn(process.execPath, [runnerPath], {
            stdio: ['pipe', 'pipe', 'pipe']
        })

        const session: RunnerSession = {
            key,
            process: child,
            pending: new Map(),
            buffer: '',
            idleTimer: undefined,
            initialized: false
        }

        child.stdout.setEncoding('utf8')
        child.stdout.on('data', (chunk: string) => this.handleStdout(session, chunk))
        child.stderr.setEncoding('utf8')
        child.stderr.on('data', (chunk: string) => {
            this.extension.outputChannel.warn(`[PlaywrightReplTool:${session.key}:stderr] ${chunk}`)
        })
        child.on('exit', () => {
            for (const pending of session.pending.values()) {
                clearTimeout(pending.timeoutHandle)
                pending.reject(new Error('runner process exited'))
            }
            session.pending.clear()
            this.sessions.delete(key)
        })

        this.sessions.set(key, session)
        return session
    }

    private async ensureSessionInitialized(session: RunnerSession): Promise<void> {
        if (session.initialized) {
            return
        }

        const config = this.readConfig()
        const response = await this.sendRequest(session, {
            id: createRequestId('init'),
            type: 'init',
            config
        }, undefined)

        if (!response.ok) {
            throw new Error(response.error?.message ?? 'failed to initialize runner')
        }

        session.initialized = true
    }

    private readConfig(): RunnerConfig {
        const conf = vscode.workspace.getConfiguration('able.playwrightRepl')
        const browserType = conf.get<BrowserTypeName>('browserType', 'chromium')
        const headless = conf.get<boolean>('headless', true)

        return {
            browserType,
            headless
        }
    }

    private sendRequest(session: RunnerSession, request: RunnerRequest, token: CancellationToken | undefined): Promise<RunnerResponse> {
        const timeoutMs = request.type === 'exec'
            ? 16000
            : 3000

        return new Promise<RunnerResponse>((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                session.pending.delete(request.id)
                this.disposeSession(session)
                reject(new Error(`request timeout: ${request.type}`))
            }, timeoutMs)

            session.pending.set(request.id, { resolve, reject, timeoutHandle })

            if (token) {
                const subscription = token.onCancellationRequested(() => {
                    subscription.dispose()
                    session.pending.delete(request.id)
                    clearTimeout(timeoutHandle)
                    this.disposeSession(session)
                    reject(new Error('tool invocation canceled'))
                })
            }

            session.process.stdin.write(`${JSON.stringify(request)}\n`)
        })
    }

    private handleStdout(session: RunnerSession, chunk: string) {
        session.buffer += chunk
        while (true) {
            const newlineIndex = session.buffer.indexOf('\n')
            if (newlineIndex < 0) {
                break
            }
            const line = session.buffer.slice(0, newlineIndex)
            session.buffer = session.buffer.slice(newlineIndex + 1)
            this.handleResponseLine(session, line)
        }
    }

    private handleResponseLine(session: RunnerSession, line: string) {
        let response: RunnerResponse | undefined
        try {
            response = JSON.parse(line) as RunnerResponse
        } catch {
            this.extension.outputChannel.error('[PlaywrightReplTool]: failed to parse runner response')
            return
        }

        if (!response || typeof response.id !== 'string') {
            return
        }

        const pending = session.pending.get(response.id)
        if (!pending) {
            return
        }

        clearTimeout(pending.timeoutHandle)
        session.pending.delete(response.id)
        pending.resolve(response)
    }

    private bumpIdleTimer(session: RunnerSession) {
        if (session.idleTimer) {
            clearTimeout(session.idleTimer)
        }
        session.idleTimer = setTimeout(() => {
            this.disposeSession(session)
        }, idleMs)
    }

    private disposeSession(session: RunnerSession) {
        if (session.idleTimer) {
            clearTimeout(session.idleTimer)
            session.idleTimer = undefined
        }

        if (!session.process.killed) {
            session.process.kill('SIGKILL')
        }
        this.sessions.delete(session.key)
    }
}

export class PlaywrightReplResetTool implements LanguageModelTool<PlaywrightReplResetInput> {
    constructor(private readonly tool: PlaywrightReplTool) {}

    prepareInvocation(_options: vscode.LanguageModelToolInvocationPrepareOptions<PlaywrightReplResetInput>) {
        return {
            invocationMessage: 'Reset persistent Playwright session'
        }
    }

    invoke(_options: LanguageModelToolInvocationOptions<PlaywrightReplResetInput>, _token: CancellationToken) {
        this.tool.dispose()
        return new LanguageModelToolResult([
            new LanguageModelTextPart('reset done')
        ])
    }
}

function createRequestId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
