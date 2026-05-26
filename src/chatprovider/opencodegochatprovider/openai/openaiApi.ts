import * as vscode from 'vscode'
import { CancellationToken, LanguageModelChatRequestMessage, ProvideLanguageModelChatResponseOptions, LanguageModelResponsePart2, Progress, LanguageModelChatInformation } from 'vscode'
import type { OpenCodeGoModelItem } from '../types.js'
import type { OpenAIChatMessage, OpenAIToolCall, ChatMessageContent, ReasoningDetail } from './openaiTypes.js'
import { isImageMimeType, createDataUrl, isToolResultPart, collectToolResultText, collectToolResultImages, convertToolsToOpenAI, mapRole, } from '../utils.js'
import { APIUsage, CommonApi } from '../commonApi.js'
import { chunkLogger, finalResponseLogger, logger } from '../logger.js'


export interface ResponseResult {
    finishReason: string | undefined;
    nativeFinishReason: string | undefined;
}

export class OpenaiApi extends CommonApi<OpenAIChatMessage, Record<string, unknown>> {
    constructor(modelInfo: LanguageModelChatInformation) {
        super(modelInfo)
    }

    /**
     * Convert VS Code chat request messages into OpenAI-compatible message objects.
     */
    convertMessages(
        messages: readonly LanguageModelChatRequestMessage[],
        modelConfig: { includeReasoningInRequest: boolean }
    ): OpenAIChatMessage[] {
        const out: OpenAIChatMessage[] = [];
        for (const m of messages) {
            const role = mapRole(m);
            const textParts: string[] = [];
            const imageParts: vscode.LanguageModelDataPart[] = [];
            const toolCalls: OpenAIToolCall[] = [];
            const toolResults: { callId: string; content: string; images: vscode.LanguageModelDataPart[] }[] = [];
            const reasoningParts: string[] = [];

            for (const part of m.content ?? []) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    textParts.push(part.value);
                } else if (part instanceof vscode.LanguageModelDataPart && isImageMimeType(part.mimeType) && this.modelCapabilities.imageInput) {
                    imageParts.push(part);
                } else if (part instanceof vscode.LanguageModelToolCallPart) {
                    const id = part.callId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                    let args: string;
                    try {
                        args = JSON.stringify(part.input ?? {});
                    } catch {
                        args = '{}';
                    }
                    toolCalls.push({ id, type: 'function', function: { name: part.name, arguments: args } });
                } else if (isToolResultPart(part)) {
                    const callId = (part as { callId?: string }).callId ?? '';
                    const content = collectToolResultText(part)
                    const images = collectToolResultImages(part)
                    toolResults.push({ callId, content, images });
                } else if (part instanceof vscode.LanguageModelThinkingPart) {
                    const content = Array.isArray(part.value) ? part.value.join('') : part.value;
                    reasoningParts.push(content);
                }
            }

            const joinedText = textParts.join('').trim();
            const joinedThinking = reasoningParts.join('').trim();

            if (role === 'assistant') {
                const assistantMessage: OpenAIChatMessage = {
                    role: 'assistant',
                };

                if (joinedText) {
                    assistantMessage.content = joinedText;
                }

                if (modelConfig.includeReasoningInRequest) {
                    assistantMessage.reasoning_content = joinedThinking
                }

                if (toolCalls.length > 0) {
                    assistantMessage.tool_calls = toolCalls;
                }

                if (assistantMessage.content || assistantMessage.reasoning_content || assistantMessage.tool_calls) {
                    out.push(assistantMessage);
                }
            }

            for (const tr of toolResults) {
                if (tr.images.length > 0 && this.modelCapabilities.imageInput) {
                    const contentArray: ChatMessageContent[] = [];
                    if (tr.content) {
                        contentArray.push({ type: 'text', text: tr.content });
                    }
                    for (const img of tr.images) {
                        const dataUrl = createDataUrl(img);
                        contentArray.push({ type: 'image_url', image_url: { url: dataUrl } });
                    }
                    out.push({ role: 'tool', tool_call_id: tr.callId, content: contentArray });
                } else {
                    out.push({ role: 'tool', tool_call_id: tr.callId, content: tr.content || '' });
                }
            }

            if (role === 'user') {
                if (imageParts.length > 0) {
                    const contentArray: ChatMessageContent[] = [];
                    if (joinedText) {
                        contentArray.push({ type: 'text', text: joinedText })
                    }
                    for (const imagePart of imageParts) {
                        const dataUrl = createDataUrl(imagePart);
                        contentArray.push({ type: 'image_url', image_url: { url: dataUrl, } })
                    }
                    out.push({ role, content: contentArray });
                } else {
                    if (joinedText) {
                        out.push({ role, content: joinedText });
                    }
                }
            }

            if (role === 'system' && joinedText) {
                out.push({ role, content: joinedText });
            }
        }
        return out;
    }

    prepareRequestBody(
        rb: Record<string, unknown>,
        um: OpenCodeGoModelItem,
        options?: ProvideLanguageModelChatResponseOptions
    ): Record<string, unknown> {
        if (um.temperature !== undefined) {
            rb['temperature'] = um.temperature;
        }

        if (um.top_p !== undefined && um.top_p !== null) {
            rb['top_p'] = um.top_p;
        }

        rb['max_completion_tokens'] = um.max_completion_tokens;

        if (um.enable_thinking && um.reasoning_effort !== undefined) {
            rb['reasoning_effort'] = um.reasoning_effort;
        }

        // Thinking mode (OpenAI-compatible format: {"thinking": {"type": "enabled"}})
        if (um.enable_thinking) {
            rb['thinking'] = { type: 'enabled' };
            if (um.thinking_budget !== undefined) {
                (rb['thinking'] as Record<string, unknown>)['budget_tokens'] = um.thinking_budget;
            }
        } else {
            rb['thinking'] = { type: 'disabled' };
        }

        // OpenRouter/OpenCode Go reasoning configuration
        if (um.reasoning !== undefined && um.reasoning.enabled !== false) {
            const reasoningObj: Record<string, unknown> = {};
            const effort = um.reasoning.effort;
            if (effort && effort !== 'auto') {
                reasoningObj['effort'] = effort;
            } else {
                reasoningObj['max_tokens'] = um.reasoning.max_tokens || 2000;
            }
            if (um.reasoning.exclude !== undefined) {
                reasoningObj['exclude'] = um.reasoning.exclude;
            }
            rb['reasoning'] = reasoningObj;
        }

        if (options?.modelOptions) {
            const mo = options.modelOptions as Record<string, unknown>;
            if (typeof mo['stop'] === 'string' || Array.isArray(mo['stop'])) {
                rb['stop'] = mo['stop'];
            }
        }

        const toolConfig = convertToolsToOpenAI(options);
        if (toolConfig.tools) {
            rb['tools'] = toolConfig.tools;
        }
        if (toolConfig.tool_choice) {
            rb['tool_choice'] = toolConfig.tool_choice;
        }

        if (um.top_k !== undefined) { rb['top_k'] = um.top_k; }
        if (um.min_p !== undefined) { rb['min_p'] = um.min_p; }
        if (um.frequency_penalty !== undefined) { rb['frequency_penalty'] = um.frequency_penalty; }
        if (um.presence_penalty !== undefined) { rb['presence_penalty'] = um.presence_penalty; }
        if (um.repetition_penalty !== undefined) { rb['repetition_penalty'] = um.repetition_penalty; }

        // Extra body parameters
        if (um.extra && typeof um.extra === 'object') {
            for (const [key, value] of Object.entries(um.extra)) {
                if (value !== undefined) {
                    rb[key] = value;
                }
            }
        }

        return rb;
    }

    /**
     * Read and parse the SSE streaming response and report parts.
     */
    async processStreamingResponse(
        responseBody: ReadableStream<Uint8Array>,
        progress: Progress<LanguageModelResponsePart2>,
        token: CancellationToken
    ): Promise<void> {
        const modelId = this.modelId
        logger.debug('openai.stream.start', { modelId });

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

                let doneFlag = false
                for (const line of lines) {
                    if (token.isCancellationRequested) {
                        break
                    }
                    if (!line.startsWith('data:')) {
                        continue;
                    }
                    const data = line.slice(5).trim()
                    chunkLogger.trace('openai.stream.chunk', { modelId, data })
                    if (data === '[DONE]') {
                        this.warnIfToolCallBuffersNotEmpty('[DONE] received')
                        // To prevent infinite loop of agents, throw error.
                        if (this._completedToolCallIndices.size === 0 && this._toolCallBuffers.size > 0) {
                            logger.error('openai.stream.tool_calls_incomplete', { modelId, bufferedIndices: Array.from(this._toolCallBuffers.keys()) })
                            throw new Error('Stream ended with incomplete tool calls')
                        }
                        doneFlag = true
                        break
                    }

                    try {
                        const parsed = JSON.parse(data) as Record<string, unknown>;
                        const result = this.processDelta(parsed, progress)
                        if (result.finishReason) {
                            responseResult = result
                        }
                        this.processUsage(parsed, progress)
                    } catch (e) {
                        logger.error('openai.stream.chunk.error', {
                            modelId,
                            error: e instanceof Error ? e.message : String(e),
                            data,
                        });
                    }
                }
                if (doneFlag) {
                    break
                }
            }
            logger.info('openai.stream.done', { modelId, responseResult });
        } catch (e) {
            logger.error('openai.stream.error', { modelId, error: e instanceof Error ? e.message : String(e) });
            throw e;
        } finally {
            cancelToken.dispose()
            this.endThinking()
            if (responseResult?.finishReason === 'stop') {
                finalResponseLogger.info('\n' + this._unifiedText)
            }
            this.emitFallbackResponseIfNeeded(responseResult, progress)
            reader.releaseLock()
        }
    }

    private emitFallbackResponseIfNeeded(responseResult: ResponseResult | undefined, progress: Progress<LanguageModelResponsePart2>) {
        if (responseResult?.finishReason === 'stop') {
            const needFallback = !this._hasEmittedAssistantText || (this.modelId.startsWith('mimo') && /<\/?think(ing)?>/.test(this._unifiedText))
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

    private processUsage(
        parsed: Record<string, unknown>,
        progress: Progress<LanguageModelResponsePart2>
    ) {
        // Capture usage from stream_options: include_usage chunks (final chunk with no choices)
        const usageData = parsed['usage'] as Record<string, unknown> | undefined;
        if (!usageData) {
            return
        }
        const promptTokens = (usageData['prompt_tokens'] as number) ?? 0
        const completionTokens = (usageData['completion_tokens'] as number) ?? 0
        const totalTokens = (usageData['total_tokens'] as number) ?? promptTokens + completionTokens
        let cacheHitTokens = 0
        let cacheMissTokens = 0

        // OpenAI format: prompt_tokens_details.cached_tokens
        const details = usageData['prompt_tokens_details'] as Record<string, unknown> | undefined;
        if (details && typeof details['cached_tokens'] === 'number') {
            cacheHitTokens = details['cached_tokens'];
            cacheMissTokens = Math.max(0, promptTokens - cacheHitTokens)
        }

        // DeepSeek format: prompt_cache_hit_tokens / prompt_cache_miss_tokens (overrides OpenAI)
        if (typeof usageData['prompt_cache_hit_tokens'] === 'number') {
            cacheHitTokens = usageData['prompt_cache_hit_tokens'];
        }
        if (typeof usageData['prompt_cache_miss_tokens'] === 'number') {
            cacheMissTokens = usageData['prompt_cache_miss_tokens'];
        }

        const apiUsage: APIUsage = {
            completion_tokens: completionTokens,
            prompt_tokens: promptTokens,
            total_tokens: totalTokens,
            prompt_tokens_details: {
                cached_tokens: cacheHitTokens,
                cache_creation_input_tokens: cacheMissTokens
            }
        }
        progress.report(new vscode.LanguageModelDataPart(new TextEncoder().encode(JSON.stringify(apiUsage)), 'usage'))
        logger.debug('openai.stream.usage', { modelId: this.modelId, usage: usageData })
    }

    /**
     * Handle a single streamed delta chunk, emitting text and tool call parts.
     */
    private processDelta(
        delta: Record<string, unknown>,
        progress: Progress<LanguageModelResponsePart2>
    ): ResponseResult {
        const choice = (delta['choices'] as Record<string, unknown>[] | undefined)?.[0];
        if (!choice) {
            return { finishReason: undefined, nativeFinishReason: undefined }
        }

        const deltaObj = choice['delta'] as Record<string, unknown> | undefined;

        // Process thinking content first (before regular text content)
        try {
            let maybeThinking =
                choice['thinking'] ??
                deltaObj?.['thinking'] ??
                deltaObj?.['reasoning'] ??
                deltaObj?.['reasoning_content'];

            // OpenRouter reasoning_details array handling
            const maybeReasoningDetails = deltaObj?.['reasoning_details'] ?? choice['reasoning_details']
            if (maybeReasoningDetails && Array.isArray(maybeReasoningDetails) && maybeReasoningDetails.length > 0) {
                const details: ReasoningDetail[] = maybeReasoningDetails as ReasoningDetail[];
                const sortedDetails = details.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

                for (const detail of sortedDetails) {
                    let extractedText = '';
                    if (detail.type === 'reasoning.summary') {
                        extractedText = (detail).summary;
                    } else if (detail.type === 'reasoning.text') {
                        extractedText = (detail).text;
                    } else if (detail.type === 'reasoning.encrypted') {
                        extractedText = '[REDACTED]';
                    } else {
                        extractedText = JSON.stringify(detail);
                    }

                    if (extractedText) {
                        this.bufferThinkingContent(extractedText, progress);
                    }
                }
                maybeThinking = null;
            }

            if (maybeThinking) {
                let text = ''
                if (typeof maybeThinking === 'object') {
                    const mt = maybeThinking as Record<string, unknown>
                    text = typeof mt['text'] === 'string' ? (mt['text']) : JSON.stringify(mt)
                } else if (typeof maybeThinking === 'string') {
                    text = maybeThinking
                }
                if (text) {
                    this.bufferThinkingContent(text, progress)
                }
            }
        } catch (e) {
            logger.error('[OpenCodeGo] Failed to process thinking/reasoning_details:', { error: e instanceof Error ? e.message : String(e) })
        }

        if (deltaObj?.['content']) {
            const content = typeof deltaObj['content'] === 'string' ? deltaObj['content'] : JSON.stringify(deltaObj['content'])

            this.endThinking()
            const res = this.processTextContent(content, progress);
            if (res.emittedAny) {
                this._hasEmittedAssistantText = true;
            }
        }

        if (deltaObj?.['tool_calls']) {
            this.endThinking()

            const toolCalls = deltaObj['tool_calls'] as Record<string, unknown>[];

            if (!this._emittedBeginToolCallsHint && this._hasEmittedAssistantText && toolCalls.length > 0) {
                progress.report(new vscode.LanguageModelTextPart(' '));
                this._emittedBeginToolCallsHint = true;
            }

            for (const tc of toolCalls) {
                const idx = (tc['index'] as number) ?? 0;
                if (this._completedToolCallIndices.has(idx)) {
                    continue;
                }
                const buf = this._toolCallBuffers.get(idx) ?? { args: '' };
                if (tc['id'] && typeof tc['id'] === 'string') {
                    buf.id = tc['id'];
                }
                const func = tc['function'] as Record<string, unknown> | undefined;
                if (func?.['name'] && typeof func['name'] === 'string') {
                    buf.name = func['name'];
                }
                if (typeof func?.['arguments'] === 'string') {
                    buf.args += func['arguments'];
                }
                this._toolCallBuffers.set(idx, buf);
            }
        }

        const finishReason = choice['finish_reason'] as string | undefined
        if (finishReason === 'tool_calls' || finishReason === 'stop') {
            if (finishReason === 'stop') {
                this.warnIfToolCallBuffersNotEmpty('finish_reason: stop received')
            }
            // We flush tool call buffers even on 'stop' anyway.
            // Having tool calls is more important signal rather than the finish reason.
            this.flushToolCallBuffers(progress)
        }
        const nativeFinishReason = choice['native_finish_reason'] as string | undefined
        return { finishReason, nativeFinishReason }
    }

}
