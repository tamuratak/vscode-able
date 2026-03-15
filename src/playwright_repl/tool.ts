import * as vscode from 'vscode'
import { CancellationToken, LanguageModelTextPart, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult, LogOutputChannel, workspace } from 'vscode'
import { findFirstBannedSyntax } from './syntaxguard.js'
import { PlaywrightReplRuntimeConfig, PlaywrightReplSession } from './session.js'
import { extractTimeoutOverrideMs } from './timeoutpragma.js'
import { classifyExecutionError } from './errorclassify.js'

export interface PlaywrightReplExecInput {
    code: string
    explanation: string
}

export interface PlaywrightReplResetInput {
    reason: string
}

let sharedSession: PlaywrightReplSession | undefined

function getSharedSession(outputChannel: LogOutputChannel): PlaywrightReplSession {
    if (!sharedSession) {
        sharedSession = new PlaywrightReplSession(outputChannel, readRuntimeConfig)
    }
    return sharedSession
}

export class PlaywrightReplExecTool implements LanguageModelTool<PlaywrightReplExecInput> {
    private readonly session: PlaywrightReplSession

    constructor(extension: {
        readonly outputChannel: LogOutputChannel
    }) {
        this.session = getSharedSession(extension.outputChannel)
    }

    async invoke(options: LanguageModelToolInvocationOptions<PlaywrightReplExecInput>, _token: CancellationToken) {
        const code = options.input.code.trim()
        if (!code) {
            throw new Error('code is empty')
        }

        const timeoutOverrideMs = extractTimeoutOverrideMs(code)

        const violation = await findFirstBannedSyntax(code)
        if (violation) {
            const errorText = [
                'blocked by syntax guard',
                `rule_id: ${violation.ruleid}`,
                `node_type: ${violation.nodetype}`,
                `line: ${String(violation.line)}`,
                `column: ${String(violation.column)}`,
                `message: ${violation.shortmessage}`,
            ].join('\n')
            return new LanguageModelToolResult([new LanguageModelTextPart(errorText)])
        }

        let result
        try {
            result = await this.session.exec(code, timeoutOverrideMs)
        } catch (error) {
            const message = toErrorMessage(error)
            const classification = classifyExecutionError(message)
            const errorText = [
                `error_class: ${classification}`,
                `message: ${message}`,
            ].join('\n')
            return new LanguageModelToolResult([new LanguageModelTextPart(errorText)])
        }

        const summaryLines = [
            `ok: ${String(result.ok)}`,
            `value: ${result.value}`,
            result.logs.length > 0 ? `logs:\n${result.logs.join('\n')}` : 'logs: (none)',
            `screenshots: ${String(result.screenshots.length)}`,
        ].join('\n')

        const parts: (LanguageModelTextPart | vscode.LanguageModelDataPart)[] = [new LanguageModelTextPart(summaryLines)]
        for (const screenshot of result.screenshots) {
            parts.push(new vscode.LanguageModelDataPart(Buffer.from(screenshot.data, 'base64'), screenshot.mimetype))
        }

        return new LanguageModelToolResult(parts)
    }
}

function toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message
    }
    return String(error)
}

export class PlaywrightReplResetTool implements LanguageModelTool<PlaywrightReplResetInput> {
    private readonly session: PlaywrightReplSession

    constructor(extension: {
        readonly outputChannel: LogOutputChannel
    }) {
        this.session = getSharedSession(extension.outputChannel)
    }

    async invoke(_options: LanguageModelToolInvocationOptions<PlaywrightReplResetInput>, _token: CancellationToken) {
        await this.session.reset()
        return new LanguageModelToolResult([new LanguageModelTextPart('playwright repl was reset')])
    }
}

function readRuntimeConfig(): PlaywrightReplRuntimeConfig {
    const cfg = workspace.getConfiguration('able.playwrightrepl.runtime')
    const browserValue = cfg.get<string>('browser')
    const browser = normalizeBrowser(browserValue)
    const channel = nonEmptyString(cfg.get<string>('channel'))
    const executablepath = nonEmptyString(cfg.get<string>('executablePath'))

    const configuredHeadless = cfg.get<boolean>('headless')
    const headless = configuredHeadless === undefined ? true : configuredHeadless

    const configuredTimeout = cfg.get<number>('timeoutMs')
    const timeoutms = typeof configuredTimeout === 'number' && configuredTimeout > 0 ? configuredTimeout : 15000

    const configuredMaxBytes = cfg.get<number>('screenshotMaxBytes')
    const screenshotmaxbytes = typeof configuredMaxBytes === 'number' && configuredMaxBytes > 0
        ? configuredMaxBytes
        : 5 * 1024 * 1024

    const configuredTotalMaxBytes = cfg.get<number>('screenshotTotalMaxBytes')
    const screenshottotalmaxbytes = typeof configuredTotalMaxBytes === 'number' && configuredTotalMaxBytes > 0
        ? configuredTotalMaxBytes
        : 10 * 1024 * 1024

    return {
        browser,
        channel,
        headless,
        executablepath,
        timeoutms,
        screenshotmaxbytes,
        screenshottotalmaxbytes,
    }
}

function normalizeBrowser(value: string | undefined): 'chromium' | 'firefox' | 'webkit' {
    if (value === 'firefox') {
        return 'firefox'
    }
    if (value === 'webkit') {
        return 'webkit'
    }
    return 'chromium'
}

function nonEmptyString(value: string | undefined): string | undefined {
    if (typeof value !== 'string') {
        return undefined
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
}
