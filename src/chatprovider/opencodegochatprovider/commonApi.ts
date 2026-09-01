/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode'
import { ProvideLanguageModelChatResponseOptions, LanguageModelChatRequestMessage, LanguageModelToolCallPart, LanguageModelResponsePart2, LanguageModelThinkingPart, Progress, CancellationToken, LanguageModelChatInformation } from 'vscode'
import { OpenCodeGoModelItem } from './types.js'
import { tryParseJSONObject } from './vscodeutils.js'
import { findRepeatingPattern } from './utils.js'
import { logger, finalResponseLogger } from './logger.js';
import type { EndpointApiType } from './models.js';
import type { AnthropicTextBlock } from './anthropic/anthropicTypes.js';

/**
 * Base result of a streamed API response, refined by each concrete API class
 * with a literal apiType and its own fields.
 */
export interface ApiResponseResult {
	apiType: EndpointApiType;
	finishReason?: string | undefined;
}

/** Result of processing a single SSE data line. */
interface SseStreamResult<TResult> {
	ended: boolean;
	// Contract: result must be set only for lines that observed an
	// end-of-turn reason (stop/finish reason); the shared loop treats
	// the last such result as the stream result.
	result: TResult | undefined;
}

/** Hooks that customize the shared SSE read loop for a concrete API client. */
interface SseStreamHooks<TResult> {
	/** Tag used in stream lifecycle log messages. */
	tag: string;
	/**
	 * Whether to log the unified text as the final response.
	 * The `processLine` callback returns a result only when it observed an
	 * end-of-turn reason (finish reason / stop reason), so the result passed
	 * here is the last such reason of the stream. Hooks must keep relying on
	 * that contract and not expect results for intermediate chunks.
	 */
	shouldLogFinalResponse(result: TResult | undefined): boolean;
	/** Emit a subclass-specific fallback response after the stream ends. */
	emitFallback(result: TResult | undefined, progress: Progress<LanguageModelResponsePart2>): void;
}

export interface APIUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	prompt_tokens_details?: {
		cached_tokens: number;
		cache_creation_input_tokens?: number;
	} | undefined;
	completion_tokens_details?: {
		reasoning_tokens: number;
	} | undefined;
}

export abstract class CommonApi<TMessage, TRequestBody> {
    /** Buffer for assembling streamed tool calls by index. */
    protected _toolCallBuffers: Map<number, { id?: string | undefined; name?: string | undefined; args: string }> = new Map<
        number,
        { id?: string; name?: string; args: string }
    >();

    /** Indices for which a tool call has been fully emitted. */
    protected _completedToolCallIndices = new Set<number>();

    /** Track if we emitted any assistant text before seeing tool calls (SSE-like begin-tool-calls hint). */
    protected _hasEmittedAssistantText = false;

    protected _unifiedText = ''
    protected _reasoningText = ''
    private prevContentType: 'text' | 'thinking' | undefined

    /** Usage captured from the stream, reported at the end of the response. */
    protected _usage: APIUsage | undefined

    // https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create#(resource)%20chat.completions%20%3E%20(model)%20chat_completion%20%3E%20(schema)%20%3E%20(property)%20choices%20%3E%20(items)%20%3E%20(property)%20finish_reason
    /**
     * The last finish reason observed in the stream. The union matches the
     * OpenAI chat-completions spec, including 'function_call' from legacy
     * function calling; 'length' and 'content_filter' are only consumed via
     * truthiness today but are kept for exhaustive future branches.
     */
    protected _finishReason: 'stop' | 'tool_calls' | 'content_filter' | 'length' | 'function_call' | undefined = undefined

    /** Set to true when a repeating pattern (infinite loop) is detected in the reasoning. */
    protected _reasoningLoopDetected = false
    private _lastReasoningLoopCheckLength = 0
    private static readonly LOOP_CHECK_INTERVAL = 500

    /** Track if we emitted the begin-tool-calls whitespace flush. */
    protected _emittedBeginToolCallsHint = false;

    /** Set to true when the stream threw before completing, so fallback text is suppressed. */
    protected _streamFailed = false;

    // Thinking content state management
    protected _currentThinkingId: string | null = null;

    /** System prompts to include in requests. */
    protected _systemContent: string | AnthropicTextBlock[] | undefined;

    /**
     * Reset stream-accumulated state so a reused instance does not leak text,
     * thinking, or loop-detection position into a new request.
     */
    protected resetStreamState(): void {
        this._unifiedText = ''
        this._reasoningText = ''
        this.prevContentType = undefined
        this._lastReasoningLoopCheckLength = 0
    }

    /** Set the model ID for logging purposes. */
    protected readonly _modelInfo: LanguageModelChatInformation

    constructor(modelInfo: LanguageModelChatInformation) {
        this._modelInfo = modelInfo
    }

    get modelId() {
        return this._modelInfo.id
    }

    get modelCapabilities() {
        return this._modelInfo.capabilities
    }

    /**
     * Convert VS Code chat messages to specific api message format.
     * @param messages The VS Code chat messages to convert.
     * @param modelConfig Config for special model.
     * @returns Specific api messages array.
     */
    abstract convertMessages(
        messages: readonly LanguageModelChatRequestMessage[],
        modelConfig: { includeReasoningInRequest: boolean }
    ): TMessage[];

    /**
     * Construct request body for Specific api
     * @param rb Specific api Request body
     * @param um Current Model Info
     * @param options From VS Code
     */
    abstract prepareRequestBody(
        rb: TRequestBody,
        um: OpenCodeGoModelItem | undefined,
        options?: ProvideLanguageModelChatResponseOptions
    ): TRequestBody;

    /**
     * Process specific api streaming response (JSON lines format).
     * @param responseBody The readable stream body.
     * @param progress Progress reporter for streamed parts.
     * @param token Cancellation token.
     */
    abstract processStreamingResponse(
        responseBody: ReadableStream<Uint8Array>,
        progress: Progress<LanguageModelResponsePart2>,
        token: CancellationToken
    ): Promise<ApiResponseResult | undefined>;

    /**
     * Flush a single buffered tool call by index.
     * Throws when the buffered arguments are not valid JSON.
     * @param idx The tool call index to flush.
     * @param progress Progress reporter for parts.
     */
    protected flushToolCallBuffer(idx: number, progress: Progress<LanguageModelResponsePart2>) {
        if (this._completedToolCallIndices.has(idx)) {
            return;
        }
        const buf = this._toolCallBuffers.get(idx);
        if (!buf) {
            return;
        }
        const argsText = buf.args.trim() || '{}';
        const parsed = tryParseJSONObject(argsText);
        if (!parsed.ok) {
            // Throw error if tool call arguments are not valid JSON. Do not try to recover. LLM is too broken at this point.
            logger.error('[OpenCodeGo] Invalid JSON for tool call', {
                idx,
                snippet: (buf.args || '').slice(0, 200),
            });
            throw new Error('Invalid JSON for tool call');
        }
        const id = buf.id ?? `call_${Math.random().toString(36).slice(2, 10)}`;
        const name = buf.name ?? 'unknown_tool';
        let parameters = parsed.value;
        parameters = this.adjustReadFileParameters(name, parameters);
        progress.report(new LanguageModelToolCallPart(id, name, parameters));
        this._toolCallBuffers.delete(idx);
        this._completedToolCallIndices.add(idx);
    }

    /**
     * Flush all buffered tool calls, optionally throwing if arguments are not valid JSON.
     * @param progress Progress reporter for parts.
     */
    protected flushToolCallBuffers(progress: Progress<LanguageModelResponsePart2>) {
        if (this._toolCallBuffers.size === 0) {
            return;
        }
        for (const idx of Array.from(this._toolCallBuffers.keys())) {
            this.flushToolCallBuffer(idx, progress);
        }
    }

    protected warnIfToolCallBuffersNotEmpty(state: string) {
        if (this._toolCallBuffers.size > 0) {
            logger.warn(
                `[OpenCodeGo] Tool call buffers are not empty when ${state}`,
                {
                    bufferedIndices: Array.from(this._toolCallBuffers.keys()),
                    count: this._toolCallBuffers.size,
                }
            )
        }
    }

    /**
     * Adjust read_file tool parameters to default to reading configurable number of lines.
     * @param toolName The name of the tool being called.
     * @param parameters The tool parameters.
     * @returns Adjusted parameters.
     */
    protected adjustReadFileParameters(toolName: string, parameters: Record<string, unknown>): Record<string, unknown> {
        if (toolName !== 'read_file') {
            return parameters;
        }
        const defaultLines = 1500

        const startLine = typeof parameters['startLine'] === 'number' ? parameters['startLine'] : 1;
        const endLine = typeof parameters['endLine'] === 'number' ? parameters['endLine'] : startLine;
        if (startLine === 1 && endLine < startLine + defaultLines) {
            return { ...parameters, endLine: startLine + defaultLines };
        } else {
            return parameters
        }
    }

    protected endThinking() {
        this._currentThinkingId = null
    }

    /**
     * Generate a unique thinking ID based on request start time and random suffix
     */
    protected generateThinkingId(): string {
        return `thinking_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }

    protected bufferThinkingContent(text: string, progress: Progress<LanguageModelResponsePart2>): void {
        if (!this._currentThinkingId) {
            this._currentThinkingId = this.generateThinkingId();
        }
        this.processUnifiedText(text, 'thinking')
        progress.report(new LanguageModelThinkingPart(text, this._currentThinkingId))
    }

    /**
     * Process regular text content (non-XML-think).
     * @param content Text content to process.
     * @param progress Progress reporter for parts.
     * @returns Object indicating whether any text was emitted.
     */
    protected processTextContent(
        content: string,
        progress: Progress<LanguageModelResponsePart2>
    ): { emittedAny: boolean } {
        if (!content) {
            return { emittedAny: false };
        }
        progress.report(new vscode.LanguageModelTextPart(content));
        this.processUnifiedText(content, 'text')
        return { emittedAny: true };
    }

    private processUnifiedText(content: string, contentType: 'text' | 'thinking'): void {
        if (this.prevContentType !== contentType && this._unifiedText) {
            // Insert separator between thinking and text content in the unified log
            this._unifiedText += '\n\n';
        }
        this._unifiedText += content
        if (contentType === 'thinking') {
            this._reasoningText += content
        }
        this.prevContentType = contentType

        // Periodically check reasoning content for repeating patterns (potential infinite loop)
        if (!this._reasoningLoopDetected && this._reasoningText.length - this._lastReasoningLoopCheckLength >= CommonApi.LOOP_CHECK_INTERVAL) {
            this._lastReasoningLoopCheckLength = this._reasoningText.length
            const result = findRepeatingPattern(this._reasoningText)
            if (result) {
                this._reasoningLoopDetected = true
                logger.warn('[OpenCodeGo] Repeating pattern detected in reasoning, aborting stream', {
                    pattern: result.pattern.slice(0, 100),
                    count: result.count,
                })
            }
        }
    }

    /**
     * Prepare headers for API request.
     * @param apiKey The API key to use.
     * @param apiMode The apiMode (affects header format).
     * @param customHeaders Optional custom headers from model config.
     * @returns Headers object.
     */
    public static prepareHeaders(
        apiKey: string,
        apiMode: EndpointApiType,
        customHeaders?: Record<string, string>
    ): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'User-Agent': 'vscode-able/10.5.4 (+https://github.com/tamuratak/vscode-able) Electron/42.8.1 Node.js/24.18.1',
            'Accept': '*/*',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
        };

        // Provider-specific header formats
        if (apiMode === 'messages') {
            headers['x-api-key'] = apiKey;
            headers['anthropic-version'] = '2023-06-01';
        } else if (apiMode === 'chat-completions' || apiMode === 'responses') {
            // OpenAI-compatible API uses Bearer auth
            headers['Authorization'] = `Bearer ${apiKey}`;
        } else {
            // Exhaustiveness guard: fail loudly when a new API mode is added.
            throw new Error(`Unsupported API mode: ${String(apiMode)}`);
        }

        // Merge custom headers if provided
        if (customHeaders) {
            for (const [key, value] of Object.entries(customHeaders)) {
                headers[key] = value;
            }
        }

        return headers;
    }

    /**
     * POST a JSON body to the given URL and return the response body stream.
     * @param url The endpoint URL.
     * @param requestBody The request body to serialize.
     * @param requestHeaders Headers to send.
     * @param signal Abort signal for cancellation.
     * @param label Human-readable API name used in error messages.
     * @returns The response body stream.
     */
    public async postAndGetBody(
        url: string,
        requestBody: unknown,
        requestHeaders: Record<string, string>,
        signal: AbortSignal,
        label: string
    ): Promise<ReadableStream<Uint8Array>> {
        const response = await fetch(url, {
            method: 'POST',
            headers: requestHeaders,
            body: JSON.stringify(requestBody),
            signal,
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error(`[OpenCodeGo] ${label} error response`, { errorText });
            throw new Error(`${label} error: [${response.status}] ${response.statusText}${errorText ? `\n${errorText}` : ''}\nURL: ${url}`);
        }

        if (!response.body) {
            logger.error('response.error', { modelId: this.modelId, error: `No response body from ${label}` });
            throw new Error(`No response body from ${label}`);
        }

        return response.body;
    }

    /**
     * Prefix used when logging the final unified response text. Shared by all
     * three API clients; the Responses client previously used a variant with
     * six trailing newlines and was deliberately unified to seven.
     */
    public static readonly FINAL_RESPONSE_PREFIX = '\n\n\n\n\n\n\n                ======================= Final Response =======================              \n\n\n\n\n\n\n';

    /**
     * Run the SSE read loop shared by the chat-completions and Anthropic
     * clients: read chunks, split them into lines, delegate each line to
     * `processLine`, stop on [DONE] or cancellation, and run the common
     * cleanup (thinking end, loop message, usage report, fallback response).
     * The loop resets `_usage` and `_finishReason` at the start; the Anthropic
     * client does not set them, so the resets are no-ops there. Usage is
     * reported only when a subclass set `_usage`; the Anthropic client reports
     * usage inside its own chunk processing, so the common report never fires
     * for it.
     */
    protected async runSseStream<TResult>(
        responseBody: ReadableStream<Uint8Array>,
        progress: Progress<LanguageModelResponsePart2>,
        token: CancellationToken,
        hooks: SseStreamHooks<TResult>,
        processLine: (line: string, progress: Progress<LanguageModelResponsePart2>) => SseStreamResult<TResult>
    ): Promise<TResult | undefined> {
        const modelId = this.modelId;
        logger.debug(`${hooks.tag}.stream.start`, { modelId });
        this._usage = undefined;
        this._finishReason = undefined;
        this._streamFailed = false;

        const reader = responseBody.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const cancelToken = token.onCancellationRequested(() => reader.cancel().catch(() => undefined));
        let result: TResult | undefined;

        try {
            // [DONE] ends the SSE event flow; the transport stream may still be open.
            let doneReceived = false;
            while (true) {
                if (token.isCancellationRequested || this._reasoningLoopDetected || doneReceived) {
                    break;
                }

                const { done, value } = await reader.read();
                if (done) {
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (token.isCancellationRequested || this._reasoningLoopDetected || doneReceived) {
                        break;
                    }
                    const res = processLine(line, progress);
                    // Only terminal observations may contribute a result (see SseStreamHooks).
                    if (res.result) {
                        result = res.result;
                    }
                    if (res.ended) {
                        // [DONE] ends the turn: stop reading even when the gateway
                        // never closes the connection (this also fixes an infinite
                        // wait on keep-alive gateways that omit EOF after [DONE]).
                        doneReceived = true;
                        break;
                    }
                }
            }

            // Process any remaining data after EOF (gateways may omit the trailing
            // newline). A truncated final line fails JSON.parse below and is logged
            // as a chunk error, indistinguishable from a parse failure. Flush the
            // decoder so multi-byte characters split at a chunk boundary are kept.
            if (!token.isCancellationRequested && !this._reasoningLoopDetected && !doneReceived) {
                buffer += decoder.decode();
                if (buffer.trim()) {
                    const res = processLine(buffer, progress);
                    // Only terminal observations may contribute a result (see SseStreamHooks).
                    if (res.result) {
                        result = res.result;
                    }
                }
            }
            logger.info(`${hooks.tag}.stream.done`, { modelId, result });
            return result;
        } catch (e) {
            if (token.isCancellationRequested) {
                // reader.cancel() from the cancellation callback can reject the
                // pending read; treat that as a clean end rather than an error.
                logger.debug(`${hooks.tag}.stream.cancelled`, { modelId: this.modelId });
                return undefined;
            }
            logger.error(`${hooks.tag}.stream.error`, { modelId, error: e instanceof Error ? e.message : String(e) });
            this._streamFailed = true;
            throw e;
        } finally {
            cancelToken.dispose();
            // Cancel unconditionally: the token may cancel a read in flight, or the
            // transport may still be open when the parser throws or [DONE] ends the
            // turn. cancel() on an already-read/closed stream is a no-op, so this
            // is safe on every path.
            await reader.cancel().catch(() => undefined);
            reader.releaseLock();
            this.endThinking();
            if (this._reasoningLoopDetected) {
                this.emitReasoningLoopMessage(progress);
            } else if (hooks.shouldLogFinalResponse(result)) {
                finalResponseLogger.info(CommonApi.FINAL_RESPONSE_PREFIX + this._unifiedText);
            }
            this.reportUsageData(progress);
            // Never emit the empty-response marker (or any fallback) when the
            // user cancelled the request: the turn must stay a clean stop so
            // no "continue" nudge is injected after a manual cancellation.
            if (!token.isCancellationRequested) {
                hooks.emitFallback(result, progress);
            }
        }
    }

    /**
     * Report captured usage as a data part with mime type "usage".
     * @param progress Progress reporter for parts.
     */
    protected reportUsageData(progress: Progress<LanguageModelResponsePart2>): void {
        if (!this._usage) {
            return;
        }
        progress.report(new vscode.LanguageModelDataPart(
            new TextEncoder().encode(JSON.stringify(this._usage)),
            'usage'
        ));
    }

    /**
     * Emit a fallback response when the model stopped without emitting any text.
     * @param progress Progress reporter for parts.
     */
    protected emitFallbackResponseIfNeeded(progress: Progress<LanguageModelResponsePart2>): void {
        // A missing finish reason means the stream ended mid-way, even when
        // some text was already emitted. In this case always emit the marker
        // so the hooks mechanism is always used: the Stop hook finds the
        // marker at the end of the latest assistant message in the transcript
        // and nudges the model to continue. The marker ends with an HTML
        // comment, which is stripped from the chat view by the sanitizer but
        // preserved in the transcript. The random hex suffix makes every
        // marker unique, so a similar literal in source code cannot be
        // mistaken for it. Streams that threw (_streamFailed) are excluded:
        // the provider classifies the failure; retryable failures end the
        // turn with a generic retry marker (the actual error is only logged),
        // while non-retryable failures are rethrown to the user.
        if (this._finishReason === undefined && !this._streamFailed) {
            const marker = `\nThis is a marker indicating that your response was empty or incomplete, generated by VS Code Chat Plugin:\n<!-- ABLE_EMPTY_RESPONSE_${Math.random().toString(16).slice(2, 10).padStart(8, '0')} -->`;
            progress.report(new vscode.LanguageModelTextPart(marker));
            logger.warn('[OpenCodeGo] Empty response detected (no finish reason, no text, no tool calls); emitted retry marker', { modelId: this.modelId });
        }
        // Do not claim "stopped before emitting text" when tool calls were emitted,
        // and do not emit anything when a reasoning loop already aborted the stream
        // or the stream threw an error.
        if (this._hasEmittedAssistantText || this._completedToolCallIndices.size > 0 || this._reasoningLoopDetected || this._streamFailed) {
            return;
        }
        if (this._finishReason === 'stop') {
            progress.report(new vscode.LanguageModelTextPart2(
                '\n[VS Code Able] The model stopped before emitting text. This may be due to the response format. Emitting thinking as a fallback.\n---\n\n',
                [vscode.LanguageModelPartAudience.User]
            ));
            progress.report(
                new vscode.LanguageModelTextPart2(
                    this._unifiedText,
                    [vscode.LanguageModelPartAudience.User]
                )
            );
            return;
        }
    }

    /**
     * Emit a redirect message when an infinite loop is detected.
     * Encourages the LLM to gather broader context via tool calls in the next turn.
     */
    protected emitReasoningLoopMessage(progress: Progress<LanguageModelResponsePart2>): void {
        const message = '[VS Code Able] Detected repetitive output. The response was aborted to prevent an infinite loop. The model may not have enough context to answer this question. Consider asking the user for more information or trying a different approach.'
        progress.report(new vscode.LanguageModelTextPart(message))
        logger.error('[OpenCodeGo] Loop redirect message emitted', { modelId: this.modelId })
    }
}
