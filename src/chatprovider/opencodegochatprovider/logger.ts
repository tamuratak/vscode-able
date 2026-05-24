import * as vscode from 'vscode'
import { inspectReadable } from '../../utils/inspect.js'
import { LanguageModelResponsePart2, Progress } from 'vscode';
import { renderMessageContent } from '../../utils/renderer.js';

const SENSITIVE_HEADER_KEYS = ['Authorization', 'x-api-key', 'x-goog-api-key'];

class Logger {
    private readonly _outputChannel: vscode.LogOutputChannel;

    constructor(label: string) {
        this._outputChannel = vscode.window.createOutputChannel(label, { log: true });
    }

    trace(tag: string, data: Record<string, unknown>): void {
        this._outputChannel.trace(`[${tag}]`, inspectReadable(data));
    }

    debug(tag: string, data: Record<string, unknown>): void {
        this._outputChannel.debug(`[${tag}]`, inspectReadable(data));
    }

    info(tag: string, data: Record<string, unknown>): void {
        this._outputChannel.info(`[${tag}]`, inspectReadable(data));
    }

    warn(tag: string, data: Record<string, unknown>): void {
        this._outputChannel.warn(`[${tag}]`, inspectReadable(data));
    }

    error(tag: string, data: Record<string, unknown>): void {
        this._outputChannel.error(`[${tag}]`, inspectReadable(data));
    }

    /**
     * Sanitize headers by redacting sensitive values.
     */
    sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
        const sanitized: Record<string, string> = {};
        for (const [key, value] of Object.entries(headers)) {
            const isSensitive = SENSITIVE_HEADER_KEYS.some(
                (k) => key.toLowerCase() === k.toLowerCase()
            );
            sanitized[key] = isSensitive ? '***' : value;
        }
        return sanitized;
    }

    /**
     * Dispose the output channel.
     */
    dispose(): void {
        this._outputChannel?.dispose();
    }
}

class MessageLogger {
    private readonly _outputChannel: vscode.OutputChannel;

    constructor(label: string) {
        this._outputChannel = vscode.window.createOutputChannel(label);
    }

    info(message: string): void {
        this._outputChannel.append(message)
    }

    wrapProgress(progress: Progress<LanguageModelResponsePart2>): Progress<LanguageModelResponsePart2> {
        let prevValue: unknown = undefined
        return {
            report: (value: LanguageModelResponsePart2) => {
                try {
                    progress.report(value)
                } catch (e) {
                    logger.error('[OpenCodeGo] Progress.report failed', {
                        error: e instanceof Error ? { name: e.name, message: e.message } : String(e),
                    });
                }
                const capturedPrev = prevValue
                prevValue = value
                renderMessageContent({ content: [value] }).then(contents => {
                    const rendered = contents.join('')
                    if ((value instanceof vscode.LanguageModelTextPart && capturedPrev instanceof vscode.LanguageModelThinkingPart) || (value instanceof vscode.LanguageModelThinkingPart && capturedPrev instanceof vscode.LanguageModelTextPart)) {
                        this._outputChannel.append('\n\n')
                    }
                    this._outputChannel.append(rendered)
                }).catch(err => {
                    logger.error('logger.message', { error: err })
                })
            }
        }
    }
}

export const logger = new Logger('OpenCodeGo')
export const chunkLogger = new Logger('OpenCodeGo - Chunk')
export const messageLogger = new MessageLogger('OpenCodeGo - Message')
export const finalResponseLogger = vscode.window.createOutputChannel('OpenCodeGo - Final Response', { log: true })
