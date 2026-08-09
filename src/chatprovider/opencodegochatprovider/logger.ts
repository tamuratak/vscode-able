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
    pendingAppends: Promise<void>;
    generation: number;
}

const POOL_SIZE = 2

class MessageLogger {
    private static readonly FLUSH_TIMEOUT_MS = 5000

    private readonly _label: string;
    private readonly _pool: ChannelSlot[];

    constructor(label: string) {
        this._label = label;
        this._pool = [];
        for (let i = 0; i < POOL_SIZE; i++) {
            this._pool.push({
                channel: vscode.window.createOutputChannel(`${label} ${i + 1}`),
                assigned: false,
                pendingAppends: Promise.resolve(),
                generation: 0,
            })
        }
    }

    private _acquireSlot(): ChannelSlot {
        const slot = this._pool.find(s => !s.assigned)
        if (slot) {
            slot.assigned = true
            slot.generation++
            return slot
        }
        // All channels are assigned; create a new one
        const newSlot: ChannelSlot = {
            channel: vscode.window.createOutputChannel(
                `${this._label} ${this._pool.length + 1}`
            ),
            assigned: true,
            pendingAppends: Promise.resolve(),
            // Same generation as a pool slot that has just been acquired.
            generation: 1,
        }
        this._pool.push(newSlot)
        return newSlot
    }

    /**
     * Release the slot once all pending writes have been flushed, so that a
     * concurrent request reusing the channel does not interleave with this
     * request's output. The release is asynchronous: the slot stays assigned
     * until the flush completes or {@link MessageLogger.FLUSH_TIMEOUT_MS}
     * elapses, so callers must not assume the slot is free immediately after
     * calling this. If the flush times out, the slot is released anyway and
     * late writes are discarded via the generation counter.
     */
    private _releaseSlot(slot: ChannelSlot): void {
        void this._releaseAfterFlush(slot)
    }

    private async _releaseAfterFlush(slot: ChannelSlot): Promise<void> {
        let timedOut = false
        let timeoutId: NodeJS.Timeout | undefined
        try {
            await Promise.race([
                slot.pendingAppends,
                new Promise<void>(resolve => {
                    timeoutId = setTimeout(() => {
                        timedOut = true
                        resolve()
                    }, MessageLogger.FLUSH_TIMEOUT_MS)
                }),
            ])
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId)
            }
            slot.assigned = false
        }
        if (timedOut) {
            try {
                logger.warn('logger.flush.timeout', { label: this._label })
            } catch {
                // Ignore logging failures so the release promise never rejects.
            }
        }
    }

    /**
     * Wrap a progress reporter with an isolated output channel.
     * Returns the wrapped progress, the channel, and a release function that must
     * be called when the chat request completes to return the channel to the pool.
     * Writes enqueued before release are flushed before the channel is returned
     * to the pool; writes that can no longer be flushed safely after a timeout
     * are discarded.
     */
    wrapProgress(progress: Progress<LanguageModelResponsePart2>): [Progress<LanguageModelResponsePart2>, vscode.OutputChannel, () => void] {
        const slot = this._acquireSlot()
        const channel = slot.channel
        let released = false
        const releaseChannel = () => {
            if (released) {
                return
            }
            released = true
            this._releaseSlot(slot)
        }
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
                if (released) {
                    // Do not enqueue after release; the channel may be in use by another request.
                    return
                }
                const capturedPrev = prevValue
                prevValue = value
                const generation = slot.generation
                slot.pendingAppends = slot.pendingAppends.then(async () => {
                    if (generation !== slot.generation) {
                        // The slot was re-acquired after a flush timeout; skip the late write.
                        return
                    }
                    const contents = await renderMessageContent({ content: [value] })
                    if (generation !== slot.generation) {
                        // The slot was re-acquired while rendering; discard the late write.
                        return
                    }
                    const rendered = contents.join('')
                    if ((value instanceof vscode.LanguageModelTextPart && capturedPrev instanceof vscode.LanguageModelThinkingPart) || (value instanceof vscode.LanguageModelThinkingPart && capturedPrev instanceof vscode.LanguageModelTextPart)) {
                        channel.append('\n\n')
                    }
                    channel.append(rendered)
                }).catch(err => {
                    try {
                        logger.error('logger.message', { error: err })
                    } catch {
                        // Ignore logging failures so the append chain never rejects.
                    }
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
