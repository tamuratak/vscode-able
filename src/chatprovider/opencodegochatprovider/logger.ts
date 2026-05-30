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

interface ChannelSlot {
    channel: vscode.OutputChannel;
    assigned: boolean;
}

const POOL_SIZE = 2

class MessageLogger {
    private readonly _label: string;
    private readonly _pool: ChannelSlot[];

    constructor(label: string) {
        this._label = label;
        this._pool = [];
        for (let i = 0; i < POOL_SIZE; i++) {
            this._pool.push({
                channel: vscode.window.createOutputChannel(`${label} ${i + 1}`),
                assigned: false,
            })
        }
    }

    private _acquireChannel(): vscode.OutputChannel {
        const slot = this._pool.find(s => !s.assigned)
        if (slot) {
            slot.assigned = true
            return slot.channel
        }
        // All channels are assigned; create a new one
        const newChannel = vscode.window.createOutputChannel(
            `${this._label} ${this._pool.length + 1}`
        );
        this._pool.push({ channel: newChannel, assigned: true })
        return newChannel
    }

    private _releaseChannel(channel: vscode.OutputChannel): void {
        const slot = this._pool.find(s => s.channel === channel)
        if (slot) {
            slot.assigned = false
        }
    }

    /**
     * Acquire a channel for a chat request and return it along with a release function.
     */
    acquire(): [vscode.OutputChannel, () => void] {
        const channel = this._acquireChannel()
        const release = () => this._releaseChannel(channel)
        return [channel, release]
    }

    /**
     * Wrap a progress reporter with an isolated output channel.
     * Returns the wrapped progress, the channel, and a release function that must
     * be called when the chat request completes to return the channel to the pool.
     */
    wrapProgress(progress: Progress<LanguageModelResponsePart2>): [Progress<LanguageModelResponsePart2>, vscode.OutputChannel, () => void] {
        const [channel, releaseChannel] = this.acquire()
        let prevValue: unknown = undefined
        const newProgress = {
            report: (value: LanguageModelResponsePart2) => {
                try {
                    progress.report(value)
                } catch (e) {
                    logger.error('[OpenCodeGo] Progress.report failed', {
                        error: e instanceof Error ? { name: e.name, message: e.message } : String(e),
                    })
                }
                const capturedPrev = prevValue
                prevValue = value
                renderMessageContent({ content: [value] }).then(contents => {
                    const rendered = contents.join('')
                    if ((value instanceof vscode.LanguageModelTextPart && capturedPrev instanceof vscode.LanguageModelThinkingPart) || (value instanceof vscode.LanguageModelThinkingPart && capturedPrev instanceof vscode.LanguageModelTextPart)) {
                        channel.append('\n\n')
                    }
                    channel.append(rendered)
                }).catch(err => {
                    logger.error('logger.message', { error: err })
                })
            }
        }
        return [newProgress, channel, releaseChannel]
    }
}

export const logger = new Logger('OpenCodeGo')
export const chunkLogger = new Logger('OpenCodeGo - Chunk')
export const messageLogger = new MessageLogger('OpenCodeGo - Message')
export const finalResponseLogger = vscode.window.createOutputChannel('OpenCodeGo - Final Response', { log: true })
