import * as vscode from 'vscode'
import { inspectReadable } from '../../utils/inspect.js'

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

export const logger = new Logger('OpenCodeGo')
export const chunkLogger = new Logger('OpenCodeGo - Chunk')
export const messageLogger = vscode.window.createOutputChannel('OpenCodeGo - Message', { log: true });
