import * as vscode from 'vscode'
import { CancellationToken, LanguageModelChatInformation, LanguageModelChatProvider, LanguageModelChatRequestMessage, ProvideLanguageModelChatResponseOptions, LanguageModelResponsePart2, Progress, } from 'vscode'
import type { OpenCodeGoModelItem } from './types.js'
import { createRetryConfig, executeWithRetry } from './utils.js'
import { getBuiltInModelConfig, getBuiltInModelInfos } from './models.js'
import { countMessageTokens } from './provideToken.js'
import { OpenaiApi } from './openai/openaiApi.js'
import { AnthropicApi } from './anthropic/anthropicApi.js'
import type { AnthropicRequestBody } from './anthropic/anthropicTypes.js'
import { CommonApi } from './commonApi.js'
import { logger, messageLogger } from './logger.js'
import { openCodeGoAuthServiceId } from '../../auth/authproviders.js'
import { renderMessages } from '../../utils/renderer.js'
import { sleep } from '../../utils/utils.js'


export class OpenCodeGoChatModelProvider implements LanguageModelChatProvider {
    /** Track last request completion time for delay calculation. */
    private _lastRequestTime: number | null = null;

    provideLanguageModelChatInformation(): LanguageModelChatInformation[] {
        return getBuiltInModelInfos();
    }

    async provideTokenCount(
        _model: LanguageModelChatInformation,
        text: string | LanguageModelChatRequestMessage
    ): Promise<number> {
        return countMessageTokens(text, { includeReasoningInRequest: true });
    }

    async provideLanguageModelChatResponse(
        model: LanguageModelChatInformation,
        messages: readonly LanguageModelChatRequestMessage[],
        options: ProvideLanguageModelChatResponseOptions,
        progressOrigin: Progress<LanguageModelResponsePart2>,
        token: CancellationToken
    ): Promise<void> {
        const progress = messageLogger.wrapProgress(progressOrigin)
        messageLogger.info('\n\n\n\n\n\n                ======================= New Request =======================              \n\n\n\n\n\n');
        messageLogger.info(await renderMessages(messages));
        const trackingProgress: Progress<LanguageModelResponsePart2> = {
            report: (part) => {
                try {
                    progress.report(part);
                } catch (e) {
                    logger.error('[OpenCodeGo] Progress.report failed', {
                        modelId: model.id,
                        error: e instanceof Error ? { name: e.name, message: e.message } : String(e),
                    });
                }
            },
        };
        const requestStartTime = Date.now();

        // Timeout controller (declared outside try so accessible in catch/finally)
        let abortController = new AbortController();
        const requestTimeoutMs = 600000
        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        try {
            const umOrig: OpenCodeGoModelItem | undefined = getBuiltInModelConfig(model.id);
            if (!umOrig) {
                throw new Error(`Model configuration not found for model ID: ${model.id}`)
            }
            const um: OpenCodeGoModelItem = { ...umOrig }

            if (options.modelConfiguration?.['reasoningEffort']) {
                const effort = options.modelConfiguration['reasoningEffort'] as unknown
                if (typeof effort === 'string') {
                    if (effort === 'disabled' && um.thinkingMode !== 'always') {
                        um.enable_thinking = false;
                        um.include_reasoning_in_request = false;
                    } else {
                        um.enable_thinking = true;
                        um.include_reasoning_in_request = true;
                        if (effort !== 'enabled') {
                            um.reasoning_effort = effort;
                        }
                    }
                }
            }

            // Determine API mode from model config (default: openai)
            const apiMode = um.apiMode
            const BASE_URL = 'https://opencode.ai/zen/go/v1'

            logger.info('request.start', {
                modelId: model.id,
                messageCount: messages.length,
                apiMode,
                BASE_URL,
            })

            // Prepare model configuration
            const modelConfig = {
                includeReasoningInRequest: um.include_reasoning_in_request ?? true,
            }

            // Apply delay between consecutive requests
            const delayMs = um.delay

            if (delayMs > 0 && this._lastRequestTime !== null) {
                const elapsed = Date.now() - this._lastRequestTime;
                if (elapsed < delayMs) {
                    const remainingDelay = delayMs - elapsed;
                    logger.debug('request.delay', { delayMs, elapsed, remainingDelay });
                    await sleep(remainingDelay)
                }
            }

            const modelApiKey = await this.ensureApiKey();

            const retryConfig = createRetryConfig();
            abortController = new AbortController();
            timeoutId = setTimeout(() => abortController.abort(), requestTimeoutMs);
            token.onCancellationRequested(() => {
                if (!abortController.signal.aborted) {
                    abortController.abort()
                }
            });

            const requestHeaders = CommonApi.prepareHeaders(modelApiKey, apiMode, um.headers);
            logger.debug('request.headers', {
                headers: logger.sanitizeHeaders(requestHeaders),
            });
            logger.debug('request.messages.origin', { messages });

            if (apiMode === 'anthropic') {
                // Anthropic API mode
                const anthropicApi = new AnthropicApi(model.id);
                const anthropicMessages = anthropicApi.convertMessages(messages, modelConfig);

                let requestBody: AnthropicRequestBody = {
                    model: um.id ?? model.id,
                    messages: anthropicMessages,
                    stream: true,
                };
                requestBody = anthropicApi.prepareRequestBody(requestBody, um, options);

                const url = `${BASE_URL}/messages`
                logger.debug('request.body', { url, requestBody });
                const response = await executeWithRetry(async () => {
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: requestHeaders,
                        body: JSON.stringify(requestBody),
                        signal: abortController.signal,
                    });

                    if (!res.ok) {
                        const errorText = await res.text();
                        logger.error('[Anthropic Provider] Anthropic API error response', { errorText });
                        throw new Error(
                            `Anthropic API error: [${res.status}] ${res.statusText}${errorText ? `\n${errorText}` : ''}\nURL: ${url}`
                        );
                    }

                    return res;
                }, retryConfig);

                if (!response.body) {
                    throw new Error('No response body from Anthropic API');
                }
                await anthropicApi.processStreamingResponse(response.body, trackingProgress, token);
            } else {
                // OpenAI Chat Completions API mode
                const openaiApi = new OpenaiApi(model.id);
                const openaiMessages = openaiApi.convertMessages(messages, modelConfig);

                // requestBody
                let requestBody: Record<string, unknown> = {
                    model: um.id ?? model.id,
                    messages: openaiMessages,
                    stream: true,
                    stream_options: { include_usage: true },
                };

                requestBody = openaiApi.prepareRequestBody(requestBody, um, options);

                // Send chat request with retry
                const url = `${BASE_URL}/chat/completions`;
                logger.debug('request.body', { url, requestBody });
                const response = await executeWithRetry(async () => {
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: requestHeaders,
                        body: JSON.stringify(requestBody),
                        signal: abortController.signal,
                    });

                    if (!res.ok) {
                        const errorText = await res.text();
                        logger.error('[OpenCodeGo] API error response', { errorText });
                        throw new Error(
                            `API error: [${res.status}] ${res.statusText}${errorText ? `\n${errorText}` : ''}\nURL: ${url}`
                        );
                    }

                    return res;
                }, retryConfig);

                if (!response.body) {
                    throw new Error('No response body from API');
                }

                messageLogger.info('\n## Progress Assistant Part\n')
                await openaiApi.processStreamingResponse(response.body, trackingProgress, token);
            }
        } catch (err) {
            // Determine if the request was aborted/terminated (friendly message instead of raw error)
            const errMessage = err instanceof Error ? err.message : String(err)
            const isTimeout = abortController.signal.aborted
            const isForceTerminated = !isTimeout && ( errMessage.includes('terminated') || errMessage.includes('aborted') || (err instanceof Error && err.name === 'AbortError') )

            if (!isTimeout) {
                abortController.abort()
            }

            if (isTimeout || isForceTerminated) {
                logger.error('request.timeout', {
                    modelId: model.id,
                    timeoutMs: requestTimeoutMs,
                    durationMs: Date.now() - requestStartTime,
                    reason: isForceTerminated ? 'connection_terminated' : 'timeout',
                })
                if (isForceTerminated) {
                    logger.error('request.terminated', { error: 'The connection was closed by the server. The generation took too long. Please try again or request shorter content.' })
                } else {
                    logger.error('request.timeout', { error: 'Request timed out. The generation took too long. You can increase the timeout in settings (opencodego.requestTimeout).' })
                }
                throw err
            }

            logger.error('[OpenCodeGo] Chat request failed', {
                modelId: model.id,
                messageCount: messages.length,
                error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
            });
            logger.error('request.error', {
                modelId: model.id,
                messageCount: messages.length,
                errorName: err instanceof Error ? err.name : String(err),
                errorMessage: err instanceof Error ? err.message : String(err),
            });
            throw err;
        } finally {
            clearTimeout(timeoutId);
            const durationMs = Date.now() - requestStartTime;
            logger.info('request.end', { modelId: model.id, durationMs });
            this._lastRequestTime = Date.now();
        }
    }

    private async ensureApiKey(): Promise<string> {
        const session = await vscode.authentication.getSession(openCodeGoAuthServiceId, [], { silent: true })
        if (!session) {
            throw new Error('No authentication session found for ' + openCodeGoAuthServiceId)
        }
        return session.accessToken
    }

}
