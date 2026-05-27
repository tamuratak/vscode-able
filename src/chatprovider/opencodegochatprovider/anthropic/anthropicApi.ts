import * as vscode from 'vscode'
import type { CancellationToken, LanguageModelChatRequestMessage, ProvideLanguageModelChatResponseOptions, LanguageModelResponsePart2, Progress, LanguageModelChatInformation, } from 'vscode'
import type { OpenCodeGoModelItem } from '../types.js'
import type { AnthropicMessage, AnthropicRequestBody, AnthropicContentBlock, AnthropicTextBlock, AnthropicImageBlock, AnthropicRedactedThinkingBlock, AnthropicToolResultBlock, AnthropicStreamChunk, } from './anthropicTypes.js'
import { isImageMimeType, isToolResultPart, convertToolsToOpenAI, mapRole } from '../utils.js'
import { APIUsage, CommonApi } from '../commonApi.js'
import { chunkLogger, finalResponseLogger, logger } from '../logger.js'


export interface MessagesApiResponseResult {
    apiType: 'messages';
    // https://platform.claude.com/docs/en/api/messages/create#message.stop_reason
    // "end_turn", "max_tokens", "stop_sequence", "tool_use", "pause_turn", "refusal"
    stopReason: string | undefined;
}

export class AnthropicApi extends CommonApi<AnthropicMessage, AnthropicRequestBody> {
    constructor(modelInfo: LanguageModelChatInformation) {
        super(modelInfo)
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

            if (role === 'system') {
                this.convertSystemMessage(m);
                continue;
            }

            const contentBlocks: AnthropicContentBlock[] = [];
            let textBuffer = '';

            const flushTextBuffer = () => {
                const trimmed = textBuffer.trim();
                if (trimmed) {
                    contentBlocks.push({ type: 'text', text: trimmed });
                }
                textBuffer = '';
            };

            for (const part of m.content ?? []) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    textBuffer += part.value;
                } else if (part instanceof vscode.LanguageModelDataPart && part.mimeType === 'cache_control' && new TextDecoder().decode(part.data) === 'ephemeral') {
                    flushTextBuffer();
                    this.applyEphemeralToLastBlock(contentBlocks);
                } else if (part instanceof vscode.LanguageModelDataPart && isImageMimeType(part.mimeType) && this.modelCapabilities.imageInput) {
                    flushTextBuffer();
                    contentBlocks.push({
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: part.mimeType,
                            data: Buffer.from(part.data).toString('base64'),
                        },
                    });
                } else if (part instanceof vscode.LanguageModelToolCallPart) {
                    flushTextBuffer();
                    const id = part.callId || `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                    contentBlocks.push({
                        type: 'tool_use',
                        id,
                        name: part.name,
                        input: (part.input as Record<string, unknown>) ?? {},
                    });
                } else if (isToolResultPart(part)) {
                    flushTextBuffer();
                    const resultContent: (AnthropicTextBlock | AnthropicImageBlock)[] = [];
                    let hasEphemeral = false
                    for (const p of part.content ?? []) {
                        if (p instanceof vscode.LanguageModelTextPart) {
                            resultContent.push({ type: 'text', text: p.value });
                        } else if (p instanceof vscode.LanguageModelDataPart && p.mimeType === 'cache_control' && new TextDecoder().decode(p.data) === 'ephemeral') {
                            hasEphemeral = true;
                        } else if (p instanceof vscode.LanguageModelDataPart && isImageMimeType(p.mimeType) && this.modelCapabilities.imageInput) {
                            resultContent.push({
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: p.mimeType,
                                    data: Buffer.from(p.data).toString('base64'),
                                },
                            });
                        }
                    }
                    const toolResultBlock: AnthropicToolResultBlock = {
                        type: 'tool_result',
                        tool_use_id: part.callId,
                        content: resultContent,
                    };
                    if (hasEphemeral) {
                        toolResultBlock.cache_control = { type: 'ephemeral' }
                    }
                    contentBlocks.push(toolResultBlock);
                } else if (part instanceof vscode.LanguageModelThinkingPart) {
                    flushTextBuffer();
                    if (modelConfig.includeReasoningInRequest) {
                        if (typeof part.metadata?.['redactedData'] === 'string') {
                            const redactedBlock: AnthropicRedactedThinkingBlock = {
                                type: 'redacted_thinking',
                                data: part.metadata['redactedData']
                            };
                            contentBlocks.push(redactedBlock);
                        } else {
                            const thinkingText = Array.isArray(part.value) ? part.value.join('') : part.value;
                            contentBlocks.push({ type: 'thinking', thinking: thinkingText });
                        }
                    }
                }
            }
            flushTextBuffer();

            if (role === 'user' && contentBlocks.some(b => b.type === 'tool_result')) {
                // Tool results in user messages are fine
            } else if (contentBlocks.some(b => b.type === 'tool_result') && role !== 'user') {
                logger.warn('anthropic.tool-results.non-user', { messageRole: role });
            }

            if (contentBlocks.length > 0) {
                out.push({ role, content: contentBlocks });
            }
        }

        return out;
    }

    private convertSystemMessage(m: LanguageModelChatRequestMessage): void {
        const textParts: string[] = [];
        let hasEphemeral = false;

        for (const part of m.content ?? []) {
            if (part instanceof vscode.LanguageModelTextPart) {
                textParts.push(part.value);
            } else if (part instanceof vscode.LanguageModelDataPart && part.mimeType === 'cache_control' && new TextDecoder().decode(part.data) === 'ephemeral') {
                hasEphemeral = true;
            }
        }

        const joinedText = textParts.join('').trim();
        if (!joinedText) {
            return;
        }

        const systemBlock: AnthropicTextBlock = { type: 'text', text: joinedText };
        if (hasEphemeral) {
            systemBlock.cache_control = { type: 'ephemeral' };
        }

        if (this._systemContent && Array.isArray(this._systemContent)) {
            this._systemContent.push(systemBlock);
        } else if (typeof this._systemContent === 'string') {
            this._systemContent = [
                { type: 'text', text: this._systemContent },
                systemBlock,
            ];
        } else {
            this._systemContent = systemBlock.cache_control ? [systemBlock] : joinedText;
        }
    }

    private applyEphemeralToLastBlock(contentBlocks: AnthropicContentBlock[]): void {
        const lastBlock = contentBlocks.at(-1);
        if (lastBlock && lastBlock.type !== 'thinking' && lastBlock.type !== 'redacted_thinking') {
            lastBlock.cache_control = { type: 'ephemeral' };
        } else {
            contentBlocks.push({
                type: 'text',
                text: ' ',
                cache_control: { type: 'ephemeral' },
            });
        }
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
    ): Promise<MessagesApiResponseResult | undefined> {
        const modelId = this.modelId
        logger.debug('anthropic.stream.start', { modelId });

        const reader = responseBody.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const cancelToken = token.onCancellationRequested(() => reader.cancel().catch(() => undefined))
        let responseResult: MessagesApiResponseResult | undefined

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
                        if (result?.stopReason) {
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
            return responseResult;
        } catch (e) {
            logger.error('anthropic.stream.error', { modelId, error: e instanceof Error ? e.message : String(e) });
            throw e;
        } finally {
            cancelToken.dispose()
            this.endThinking()
            if (responseResult?.stopReason === 'end_turn') {
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
    ): MessagesApiResponseResult | undefined {
        // Handle ping events (ignore)
        if (chunk.type === 'ping') {
            return undefined;
        } else if (chunk.type === 'error') {
            const errorType = chunk.error?.type || 'unknown_error';
            const errorMessage = chunk.error?.message || 'Anthropic API streaming error';
            logger.error('anthropic.stream.error.chunk', {
                modelId: this.modelId,
                errorType,
                errorMessage,
            });
            return undefined;
        } else if (chunk.type === 'message_start') {
            return undefined
        } else if (chunk.type === 'message_delta' && chunk.delta) {
            // Process usage information from message_delta
            if (chunk.usage) {
                const inputTokens = chunk.usage.input_tokens ?? 0;
                const outputTokens = chunk.usage.output_tokens ?? 0;
                const cacheCreationTokens = chunk.usage.cache_creation_input_tokens ?? 0
                const cacheReadTokens = chunk.usage.cache_read_input_tokens ?? 0
                // prompt_tokens includes cache tokens to reflect the total input consumed
                const promptTokens = inputTokens + cacheCreationTokens + cacheReadTokens;
                const apiUsage: APIUsage = {
                    completion_tokens: outputTokens,
                    prompt_tokens: promptTokens,
                    total_tokens: promptTokens + outputTokens,
                    prompt_tokens_details: {
                        cached_tokens: cacheReadTokens,
                        cache_creation_input_tokens: cacheCreationTokens,
                    }
                };
                progress.report(new vscode.LanguageModelDataPart(new TextEncoder().encode(JSON.stringify(apiUsage)), 'usage'));
                logger.debug('anthropic.stream.usage', { modelId: this.modelId, usage: chunk.usage });
            }

            // Extract stop_reason
            const stopReason = chunk.delta.stop_reason;
            if (stopReason) {
                if (stopReason === 'end_turn' || stopReason === 'tool_use') {
                    this.warnIfToolCallBuffersNotEmpty('stop_reason: ' + stopReason)
                    this.flushToolCallBuffers(progress)
                }
                return { apiType: 'messages', stopReason }
            }
            return undefined;
        } else if (chunk.type === 'content_block_start' && chunk.content_block) {
            // Start of a content block
            if (chunk.content_block.type === 'thinking') {
                if (chunk.content_block.thinking) {
                    this.bufferThinkingContent(chunk.content_block.thinking, progress);
                }
            } else if (chunk.content_block.type === 'redacted_thinking') {
                // Redacted thinking block - emit as a thinking part with encrypted data in metadata
                if (chunk.content_block.data) {
                    if (!this._currentThinkingId) {
                        this._currentThinkingId = this.generateThinkingId();
                    }
                    progress.report(new vscode.LanguageModelThinkingPart(
                        chunk.content_block.data,
                        this._currentThinkingId,
                        { redactedData: chunk.content_block.data }
                    ));
                    this.endThinking();
                }
            } else if (chunk.content_block.type === 'tool_use') {
                // Start tool call block
                if (!this._emittedBeginToolCallsHint && this._hasEmittedAssistantText) {
                    progress.report(new vscode.LanguageModelTextPart(' '));
                    this._emittedBeginToolCallsHint = true;
                }
                const idx = chunk.index ?? 0
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
                const idx = chunk.index ?? 0
                const buf = this._toolCallBuffers.get(idx);
                if (buf) {
                    buf.args += chunk.delta.partial_json;
                    this._toolCallBuffers.set(idx, buf);
                }
            } else if (chunk.delta.type === 'signature_delta' && chunk.delta.signature) {
                // Signature for thinking block - ignore for now
            } else if (chunk.delta.type === 'redacted_delta' && chunk.delta.data) {
                // Redacted thinking delta - store as encrypted data
                if (!this._currentThinkingId) {
                    this._currentThinkingId = this.generateThinkingId();
                }
                progress.report(new vscode.LanguageModelThinkingPart(
                    chunk.delta.data,
                    this._currentThinkingId,
                    { redactedData: chunk.delta.data }
                ));
            }
        } else if (chunk.type === 'content_block_stop' || chunk.type === 'message_stop') {
            // End of message - ensure thinking is ended and flush all tool calls
            this.flushToolCallBuffers(progress)
            this.endThinking()
        }
        return undefined;
    }

    private emitFallbackResponseIfNeeded(responseResult: MessagesApiResponseResult | undefined, progress: Progress<LanguageModelResponsePart2>) {
        if (responseResult?.stopReason === 'end_turn') {
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
