/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode'
import { ProvideLanguageModelChatResponseOptions, LanguageModelChatRequestMessage, LanguageModelToolCallPart, LanguageModelResponsePart2, LanguageModelThinkingPart, Progress, CancellationToken, LanguageModelChatInformation } from 'vscode'
import { OpenCodeGoModelItem } from './types.js'
import { tryParseJSONObject } from './utils.js'
import { logger } from './logger.js';
import type { EndpointApiType } from './models.js';
import type { AnthropicTextBlock } from './anthropic/anthropicTypes.js';
import type { MessagesResult } from './anthropic/anthropicApi.js';
import type { ChatCompletionsResult } from './openai/openaiApi.js';

export interface APIUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	prompt_tokens_details?: {
		cached_tokens: number;
		cache_creation_input_tokens?: number;
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
    private prevContentType: 'text' | 'thinking' | undefined

    /** Track if we emitted the begin-tool-calls whitespace flush. */
    protected _emittedBeginToolCallsHint = false;

    // Thinking content state management
    protected _currentThinkingId: string | null = null;

    /** System prompts to include in requests. */
    protected _systemContent: string | AnthropicTextBlock[] | undefined;

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
    ): Promise<ChatCompletionsResult | MessagesResult | undefined>;

    /**
     * Flush all buffered tool calls, optionally throwing if arguments are not valid JSON.
     * @param progress Progress reporter for parts.
     */
    protected flushToolCallBuffers(progress: Progress<LanguageModelResponsePart2>) {
        if (this._toolCallBuffers.size === 0) {
            return;
        }
        for (const [idx, buf] of Array.from(this._toolCallBuffers.entries())) {
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
        this.prevContentType = contentType
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
            'User-Agent': 'ai-sdk/openai-compatible/2.0.41 ai-sdk/provider-utils/4.0.23 runtime/bun/1.3.11',
            'Accept': '*/*',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
        };

        // Provider-specific header formats
        if (apiMode === 'messages') {
            headers['x-api-key'] = apiKey;
            headers['anthropic-version'] = '2023-06-01';
        } else if (apiMode === 'chat-completions') {
            // OpenAI-compatible API uses Bearer auth
            headers['Authorization'] = `Bearer ${apiKey}`;
        } else {
            throw new Error(`Unsupported API mode: ${apiMode}`)
        }

        // Merge custom headers if provided
        if (customHeaders) {
            for (const [key, value] of Object.entries(customHeaders)) {
                headers[key] = value;
            }
        }

        return headers;
    }
}
