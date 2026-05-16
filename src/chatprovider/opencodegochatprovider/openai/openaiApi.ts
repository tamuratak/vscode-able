import * as vscode from 'vscode'
import { CancellationToken, LanguageModelChatRequestMessage, ProvideLanguageModelChatResponseOptions, LanguageModelResponsePart2, Progress } from 'vscode'
import type { OpenCodeGoModelItem } from '../types.js'
import type { OpenAIChatMessage, OpenAIToolCall, ChatMessageContent, ReasoningDetail } from './openaiTypes.js'
import { isImageMimeType, createDataUrl, isToolResultPart, collectToolResultText, convertToolsToOpenAI, mapRole, } from '../utils.js'
import { APIUsage, CommonApi, StreamUsage } from '../commonApi.js'
import { chunkLogger, logger } from '../logger.js'

export class OpenaiApi extends CommonApi<OpenAIChatMessage, Record<string, unknown>> {
    constructor(modelId: string) {
        super(modelId);
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
            const toolResults: { callId: string; content: string }[] = [];
            const reasoningParts: string[] = [];

            for (const part of m.content ?? []) {
                if (part instanceof vscode.LanguageModelTextPart) {
                    textParts.push(part.value);
                } else if (part instanceof vscode.LanguageModelDataPart && isImageMimeType(part.mimeType)) {
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
                    const content = collectToolResultText(part as { content?: readonly unknown[] });
                    toolResults.push({ callId, content });
                } else if (part instanceof vscode.LanguageModelThinkingPart) {
                    const content = Array.isArray(part.value) ? part.value.join('') : part.value;
                    reasoningParts.push(content);
                }
            }

            const joinedText = textParts.join('').trim();
            const joinedThinking = reasoningParts.join('').trim();

            // process assistant message
            if (role === 'assistant') {
                const assistantMessage: OpenAIChatMessage = {
                    role: 'assistant',
                };

                if (joinedText) {
                    assistantMessage.content = joinedText;
                }

                if (modelConfig.includeReasoningInRequest) {
                    assistantMessage.reasoning_content = joinedThinking || 'Next step.';
                }

                if (toolCalls.length > 0) {
                    assistantMessage.tool_calls = toolCalls;
                }

                if (assistantMessage.content || assistantMessage.reasoning_content || assistantMessage.tool_calls) {
                    out.push(assistantMessage);
                }
            }

            // process tool result messages
            for (const tr of toolResults) {
                out.push({ role: 'tool', tool_call_id: tr.callId, content: tr.content || '' });
            }

            // process user messages
            if (role === 'user') {
                if (imageParts.length > 0) {
                    // multi-modal message
                    const contentArray: ChatMessageContent[] = [];

                    if (joinedText) {
                        contentArray.push({
                            type: 'text',
                            text: joinedText,
                        });
                    }

                    for (const imagePart of imageParts) {
                        const dataUrl = createDataUrl(imagePart);
                        contentArray.push({
                            type: 'image_url',
                            image_url: {
                                url: dataUrl,
                            },
                        });
                    }
                    out.push({ role, content: contentArray });
                } else {
                    // text-only message
                    if (joinedText) {
                        out.push({ role, content: joinedText });
                    }
                }
            }

            // process system messages
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
        // temperature
        if (um.temperature !== undefined) {
            rb['temperature'] = um.temperature;
        }

        // top_p
        if (um.top_p !== undefined && um.top_p !== null) {
            rb['top_p'] = um.top_p;
        }

        rb['max_completion_tokens'] = um.max_completion_tokens;

        // OpenAI reasoning configuration (only set when thinking is enabled)
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

        // stop
        if (options?.modelOptions) {
            const mo = options.modelOptions as Record<string, unknown>;
            if (typeof mo['stop'] === 'string' || Array.isArray(mo['stop'])) {
                rb['stop'] = mo['stop'];
            }
        }

        // tools
        const toolConfig = convertToolsToOpenAI(options);
        if (toolConfig.tools) {
            rb['tools'] = toolConfig.tools;
        }
        if (toolConfig.tool_choice) {
            rb['tool_choice'] = toolConfig.tool_choice;
        }

        // Extra model parameters
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
        const modelId = this._modelId;
        logger.debug('openai.stream.start', { modelId });

        const reader = responseBody.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        token.onCancellationRequested(() => reader.cancel().catch(() => undefined) )

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
                    if (!line.startsWith('data:')) {
                        continue;
                    }
                    const data = line.slice(5).trim()
                    chunkLogger.trace('openai.stream.chunk', { modelId, data })
                    if (data === '[DONE]') {
                        this.flushToolCallBuffers(progress, false);
                        continue;
                    }

                    try {
                        const parsed = JSON.parse(data) as Record<string, unknown>;

                        // Capture usage from stream_options: include_usage chunks (final chunk with no choices)
                        const usageData = parsed['usage'] as Record<string, unknown> | undefined;
                        if (usageData) {
                            let cacheHitTokens: number | undefined;
                            let cacheMissTokens: number | undefined;

                            // OpenAI format: prompt_tokens_details.cached_tokens
                            const details = usageData['prompt_tokens_details'] as Record<string, unknown> | undefined;
                            if (details && typeof details['cached_tokens'] === 'number') {
                                cacheHitTokens = details['cached_tokens'];
                                cacheMissTokens = ((usageData['prompt_tokens'] as number) ?? 0) - cacheHitTokens;
                            }

                            // DeepSeek format: prompt_cache_hit_tokens / prompt_cache_miss_tokens (overrides OpenAI)
                            if (typeof usageData['prompt_cache_hit_tokens'] === 'number') {
                                cacheHitTokens = usageData['prompt_cache_hit_tokens'];
                            }
                            if (typeof usageData['prompt_cache_miss_tokens'] === 'number') {
                                cacheMissTokens = usageData['prompt_cache_miss_tokens'];
                            }

                            const usage: StreamUsage = {
                                promptTokens: (usageData['prompt_tokens'] as number) ?? 0,
                                completionTokens: (usageData['completion_tokens'] as number) ?? 0,
                                cacheHitTokens,
                                cacheMissTokens,
                            };
                            const apiUsage: APIUsage = {
                                completion_tokens: usage.completionTokens,
                                prompt_tokens: usage.promptTokens,
                                total_tokens: usage.promptTokens + usage.completionTokens,
                                prompt_tokens_details: cacheHitTokens !== undefined && cacheMissTokens !== undefined ? { cached_tokens: cacheHitTokens, cache_creation_input_tokens: cacheMissTokens } : undefined
                            }
                            progress.report(new vscode.LanguageModelDataPart(new TextEncoder().encode(JSON.stringify(apiUsage)), 'usage'));
                            logger.debug('openai.stream.usage', { modelId, usage })
                        }

                        this.processDelta(parsed, progress);
                    } catch (e) {
                        logger.error('openai.stream.chunk.error', {
                            modelId,
                            error: e instanceof Error ? e.message : String(e),
                            data,
                        });
                    }
                }
            }
            logger.debug('openai.stream.done', { modelId });
        } catch (e) {
            logger.error('openai.stream.error', { modelId, error: e instanceof Error ? e.message : String(e) });
            throw e;
        } finally {
            reader.releaseLock();
            this.reportEndThinking(progress);
        }
    }

    /**
     * Handle a single streamed delta chunk, emitting text and tool call parts.
     */
    private processDelta(
        delta: Record<string, unknown>,
        progress: Progress<LanguageModelResponsePart2>
    ): boolean {
        let emitted = false;
        const choice = (delta['choices'] as Record<string, unknown>[] | undefined)?.[0];
        if (!choice) {
            return false;
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
                        emitted = true;
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
                    emitted = true
                }
            }
        } catch (e) {
            logger.error('[OpenCodeGo] Failed to process thinking/reasoning_details:', { error: e instanceof Error ? e.message : String(e) })
        }

        if (deltaObj?.['content']) {
            const content = typeof deltaObj['content'] === 'string' ? deltaObj['content'] : JSON.stringify(deltaObj['content'])

            this.reportEndThinking(progress);
            const res = this.processTextContent(content, progress);
            if (res.emittedAny) {
                this._hasEmittedAssistantText = true;
                emitted = true;
            }
        }

        if (deltaObj?.['tool_calls']) {
            this.reportEndThinking(progress);

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

                this.tryEmitBufferedToolCall(idx, progress);
            }
        }

        const finish = choice['finish_reason'] ?? undefined;
        if (finish === 'tool_calls' || finish === 'stop') {
            this.flushToolCallBuffers(progress, true);
        }
        return emitted;
    }

}
