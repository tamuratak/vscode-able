import * as vscode from 'vscode';
import {
    CancellationToken,
    LanguageModelChatRequestMessage,
    ProvideLanguageModelChatResponseOptions,
    LanguageModelResponsePart2,
    Progress,
} from 'vscode';

import type { OpenCodeGoModelItem } from '../types.js';

import type {
    AnthropicMessage,
    AnthropicRequestBody,
    AnthropicContentBlock,
    AnthropicToolUseBlock,
    AnthropicToolResultBlock,
    AnthropicStreamChunk,
} from './anthropicTypes.js';

import { isImageMimeType, isToolResultPart, collectToolResultText, convertToolsToOpenAI, mapRole } from '../utils.js';

import { APIUsage, CommonApi } from '../commonApi.js';
import { chunkLogger, finalResponseLogger, logger } from '../logger.js';

export interface ResponseResult {
    finishReason: string | undefined;
}

export class AnthropicApi extends CommonApi<AnthropicMessage, AnthropicRequestBody> {
    constructor(modelId: string) {
        super(modelId);
    }

    /**
     * Convert VS Code chat messages to Anthropic message format.
     * @param messages The VS Code chat messages to convert.
     * @param modelConfig model configuration that may affect message conversion.
     * @returns Anthropic-compatible messages array.
     */
    convertMessages(
        messages: readonly LanguageModelChatRequestMessage[],
        modelConfig: { includeReasoningInRequest: boolean }
    ): AnthropicMessage[] {
        const out: AnthropicMessage[] = [];

        for (const m of messages) {
            const role = mapRole(m);
            const textParts: string[] = [];
            const imageParts: vscode.LanguageModelDataPart[] = [];
            const toolCalls: AnthropicToolUseBlock[] = [];
            const toolResults: AnthropicToolResultBlock[] = [];
            const thinkingParts: string[] = [];

            for (const part of m.content ?? []) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    textParts.push(part.value);
                } else if (part instanceof vscode.LanguageModelDataPart && isImageMimeType(part.mimeType)) {
                    imageParts.push(part);
                } else if (part instanceof vscode.LanguageModelToolCallPart) {
                    const id = part.callId || `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                    toolCalls.push({
                        type: 'tool_use',
                        id,
                        name: part.name,
                        input: (part.input as Record<string, unknown>) ?? {},
                    });
                } else if (isToolResultPart(part)) {
                    const content = collectToolResultText(part)
                    toolResults.push({
                        type: 'tool_result',
                        tool_use_id: part.callId,
                        content,
                    });
                } else if (part instanceof vscode.LanguageModelThinkingPart) {
                    const content = Array.isArray(part.value) ? part.value.join('') : part.value;
                    thinkingParts.push(content);
                }
            }

            const joinedText = textParts.join('').trim();
            const joinedThinking = thinkingParts.join('').trim();

            // Handle system messages separately (Anthropic uses top-level system field)
            if (role === 'system') {
                if (joinedText) {
                    this._systemContent = joinedText;
                }
                continue;
            }

            // Build content blocks for user/assistant messages
            const contentBlocks: AnthropicContentBlock[] = [];

            // Add text content
            if (joinedText) {
                contentBlocks.push({
                    type: 'text',
                    text: joinedText,
                });
            }

            // Add image content
            for (const imagePart of imageParts) {
                const base64Data = Buffer.from(imagePart.data).toString('base64');
                contentBlocks.push({
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: imagePart.mimeType,
                        data: base64Data,
                    },
                });
            }

            // Add thinking content for assistant messages
            if (role === 'assistant' && modelConfig.includeReasoningInRequest) {
                contentBlocks.push({
                    type: 'thinking',
                    thinking: joinedThinking,
                });
            }

            // Add tool calls for assistant messages
            for (const toolCall of toolCalls) {
                contentBlocks.push(toolCall);
            }

            // For tool results, they should be added to user messages
            if (role === 'user' && toolResults.length > 0) {
                for (const toolResult of toolResults) {
                    contentBlocks.push(toolResult);
                }
            } else if (toolResults.length > 0) {
                // If tool results appear in non-user messages, log warning
                console.warn('[Anthropic Provider] Tool results found in non-user message, ignoring');
                logger.warn('anthropic.tool-results.non-user', {
                    messageRole: role,
                    toolResultCount: toolResults.length,
                });
            }

            // Only add message if we have content blocks
            if (contentBlocks.length > 0) {
                out.push({
                    role,
                    content: contentBlocks,
                });
            }
        }

        return out;
    }

    prepareRequestBody(
        rb: AnthropicRequestBody,
        um: OpenCodeGoModelItem,
        options?: ProvideLanguageModelChatResponseOptions
    ): AnthropicRequestBody {
        rb.max_tokens = um.max_completion_tokens

        // Add system content if we extracted it
        if (this._systemContent) {
            rb.system = this._systemContent;
        }

        // Add temperature
        if (um.temperature !== undefined) {
            rb.temperature = um.temperature;
        }

        // Add top_p if configured
        if (um.top_p !== undefined && um.top_p !== null) {
            rb.top_p = um.top_p;
        }

        // Add top_k if configured
        if (um.top_k !== undefined) {
            rb.top_k = um.top_k;
        }

        // Add tools configuration
        const toolConfig = convertToolsToOpenAI(options);
        if (toolConfig.tools) {
            // Convert OpenAI tool definitions to Anthropic format
            rb.tools = toolConfig.tools.map((tool) => ({
                name: tool.function.name,
                description: tool.function.description,
                input_schema: tool.function.parameters,
            }));
        }

        // Add tool_choice (Anthropic format)
        if (toolConfig.tool_choice) {
            if (toolConfig.tool_choice === 'auto') {
                rb.tool_choice = { type: 'auto' };
            } else if (toolConfig.tool_choice === 'none') {
                rb.tool_choice = { type: 'none' };
            } else if (toolConfig.tool_choice === 'required') {
                rb.tool_choice = { type: 'any' };
            }
        }

        if (um.extra && typeof um.extra === 'object') {
            Object.assign(rb, um.extra);
        }

        return rb;
    }

    /**
     * Process Anthropic streaming response (SSE format).
     * @param responseBody The readable stream body.
     * @param progress Progress reporter for streamed parts.
     * @param token Cancellation token.
     */
    async processStreamingResponse(
        responseBody: ReadableStream<Uint8Array>,
        progress: Progress<LanguageModelResponsePart2>,
        token: CancellationToken
    ): Promise<void> {
        const modelId = this._modelId;
        logger.debug('anthropic.stream.start', { modelId });

        const reader = responseBody.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const cancelToken = token.onCancellationRequested(() => reader.cancel().catch(() => undefined))
        let responseResult: ResponseResult | undefined

        try {
            while (true) {
                if (token.isCancellationRequested) {
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
                    if (token.isCancellationRequested) {
                        break
                    }
                    if (line.trim() === '') {
                        continue;
                    }
                    if (!line.startsWith('data:')) {
                        continue;
                    }

                    const data = line.slice(5).trim()
                    chunkLogger.trace('anthropic.stream.chunk', { modelId, data })
                    if (data === '[DONE]') {
                        this.warnIfToolCallBuffersNotEmpty('[DONE] received')
                        break
                    }

                    try {
                        const chunk = JSON.parse(data) as AnthropicStreamChunk;
                        const result = this.processAnthropicChunk(chunk, progress);
                        if (result?.finishReason) {
                            responseResult = result
                        }
                    } catch (e) {
                        logger.error('anthropic.stream.chunk.error', {
                            modelId,
                            error: e instanceof Error ? e.message : String(e),
                            data,
                        });
                    }
                }
            }
            logger.info('anthropic.stream.done', { modelId, responseResult });
        } catch (e) {
            logger.error('anthropic.stream.error', { modelId, error: e instanceof Error ? e.message : String(e) });
            throw e;
        } finally {
            cancelToken.dispose()
            this.endThinking()
            if (responseResult?.finishReason === 'end_turn') {
                finalResponseLogger.info('\n' + this._unifiedText)
            }
            this.emitFallbackResponseIfNeeded(responseResult, progress)
            reader.releaseLock()
        }
    }

    /**
     * Process a single Anthropic streaming chunk.
     * @param chunk Parsed Anthropic stream chunk.
     * @param progress Progress reporter for parts.
     * @returns Response result with finish reason information.
     */
    private processAnthropicChunk(
        chunk: AnthropicStreamChunk,
        progress: Progress<LanguageModelResponsePart2>
    ): ResponseResult | undefined {
        // Handle ping events (ignore)
        if (chunk.type === 'ping') {
            return undefined;
        }

        // Handle error events
        if (chunk.type === 'error') {
            const errorType = chunk.error?.type || 'unknown_error';
            const errorMessage = chunk.error?.message || 'Anthropic API streaming error';
            logger.error('anthropic.stream.error.chunk', {
                modelId: this._modelId,
                errorType,
                errorMessage,
            });
            return undefined;
        }

        if (chunk.type === 'message_start' && chunk.message) {
            // Extract message metadata (id, model, etc.)
            return undefined;
        }

        if (chunk.type === 'message_delta' && chunk.delta) {
            // Process usage information from message_delta
            if (chunk.usage) {
                const inputTokens = chunk.usage.input_tokens ?? 0;
                const outputTokens = chunk.usage.output_tokens ?? 0;
                const apiUsage: APIUsage = {
                    completion_tokens: outputTokens,
                    prompt_tokens: inputTokens,
                    total_tokens: inputTokens + outputTokens,
                    prompt_tokens_details: {
                        cached_tokens: chunk.usage.cache_read_input_tokens ?? 0,
                        cache_creation_input_tokens: chunk.usage.cache_creation_input_tokens ?? 0,
                    }
                };
                progress.report(new vscode.LanguageModelDataPart(new TextEncoder().encode(JSON.stringify(apiUsage)), 'usage'));
                logger.debug('anthropic.stream.usage', { modelId: this._modelId, usage: chunk.usage });
            }

            // Extract stop_reason
            const stopReason = chunk.delta.stop_reason;
            if (stopReason) {
                if (stopReason === 'end_turn' || stopReason === 'tool_use') {
                    this.warnIfToolCallBuffersNotEmpty('stop_reason: ' + stopReason)
                    this.flushToolCallBuffers(progress)
                }
                return { finishReason: stopReason }
            }
            return undefined;
        }

        if (chunk.type === 'content_block_start' && chunk.content_block) {
            // Start of a content block
            if (chunk.content_block.type === 'thinking') {
                if (chunk.content_block.thinking) {
                    this.bufferThinkingContent(chunk.content_block.thinking, progress);
                }
            } else if (chunk.content_block.type === 'tool_use') {
                // Start tool call block
                if (!this._emittedBeginToolCallsHint && this._hasEmittedAssistantText) {
                    progress.report(new vscode.LanguageModelTextPart(' '));
                    this._emittedBeginToolCallsHint = true;
                }
                const idx = (chunk.index as number) ?? 0;
                this._toolCallBuffers.set(idx, {
                    id: chunk.content_block.id,
                    name: chunk.content_block.name,
                    args: '',
                });
            } else if (chunk.content_block.type === 'text') {
                // Text block start - nothing special to do
            }
        } else if (chunk.type === 'content_block_delta' && chunk.delta) {
            if (chunk.delta.type === 'text_delta' && chunk.delta.text) {
                this.endThinking()
                const res = this.processTextContent(chunk.delta.text, progress);
                if (res.emittedAny) {
                    this._hasEmittedAssistantText = true;
                }
            } else if (chunk.delta.type === 'thinking_delta' && chunk.delta.thinking) {
                this.bufferThinkingContent(chunk.delta.thinking, progress);
            } else if (chunk.delta.type === 'input_json_delta' && chunk.delta.partial_json) {
                const idx = (chunk.index as number) ?? 0;
                const buf = this._toolCallBuffers.get(idx);
                if (buf) {
                    buf.args += chunk.delta.partial_json;
                    this._toolCallBuffers.set(idx, buf);
                }
            } else if (chunk.delta.type === 'signature_delta' && chunk.delta.signature) {
                // Signature for thinking block - ignore for now
            }
        } else if (chunk.type === 'content_block_stop' || chunk.type === 'message_stop') {
            // End of message - ensure thinking is ended and flush all tool calls
            this.flushToolCallBuffers(progress)
            this.endThinking()
        }
        return undefined;
    }

    private emitFallbackResponseIfNeeded(responseResult: ResponseResult | undefined, progress: Progress<LanguageModelResponsePart2>) {
        if (responseResult?.finishReason === 'end_turn') {
            const needFallback = !this._hasEmittedAssistantText
            if (needFallback) {
                progress.report(new vscode.LanguageModelTextPart2(
                    '\n[OpenCode Go] The model stopped before emitting text. This may be due to the response format. Emitting thinking as a fallback.\n---\n\n',
                    [vscode.LanguageModelPartAudience.User]
                ))
                progress.report(
                    new vscode.LanguageModelTextPart2(
                        this._unifiedText,
                        [vscode.LanguageModelPartAudience.User]
                    )
                )
            }
        }
    }

}
