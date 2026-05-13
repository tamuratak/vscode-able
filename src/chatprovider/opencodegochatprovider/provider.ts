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
import { logger } from './logger.js'
import { openCodeGoAuthServiceId } from '../../auth/authproviders.js'


export class OpenCodeGoChatModelProvider implements LanguageModelChatProvider {
    /** Track last request completion time for delay calculation. */
    private _lastRequestTime: number | null = null;

    provideLanguageModelChatInformation(): LanguageModelChatInformation[] {
        return getBuiltInModelInfos();
    }

    async provideTokenCount(
        _model: LanguageModelChatInformation,
        text: string | LanguageModelChatRequestMessage,
        _token: CancellationToken
    ): Promise<number> {
        return countMessageTokens(text, { includeReasoningInRequest: true });
    }

    async provideLanguageModelChatResponse(
        model: LanguageModelChatInformation,
        messages: readonly LanguageModelChatRequestMessage[],
        options: ProvideLanguageModelChatResponseOptions,
        progress: Progress<LanguageModelResponsePart2>,
        token: CancellationToken
    ): Promise<void> {
        const trackingProgress: Progress<LanguageModelResponsePart2> = {
            report: (part) => {
                try {
                    progress.report(part);
                } catch (e) {
                    console.error('[OpenCodeGo] Progress.report failed', {
                        modelId: model.id,
                        error: e instanceof Error ? { name: e.name, message: e.message } : String(e),
                    });
                }
            },
        };
        const requestStartTime = Date.now();

        // Timeout controller (declared outside try so accessible in catch/finally)
        let abortController = new AbortController();
        let requestTimeoutMs = 600000;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        let dispatchFetch: typeof fetch;

        try {
            // Get built-in model config
            const config = vscode.workspace.getConfiguration();
            const um: OpenCodeGoModelItem | undefined = getBuiltInModelConfig(model.id);

            // Apply reasoning effort from model configuration to determine thinking mode
            // - "disabled" → turn off thinking (unless model has thinkingMode="always")
            // - "enabled" → turn on thinking with default effort
            // - "high"/"max" → turn on thinking with specified effort
            if (um && options.modelConfiguration?.['reasoningEffort']) {
                const effort = options.modelConfiguration['reasoningEffort'] as string;
                if (typeof effort === 'string') {
                    if (effort === 'disabled') {
                        if (um.thinkingMode !== 'always') {
                            um.enable_thinking = false;
                            um.include_reasoning_in_request = false;
                        }
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
            const apiMode = um?.apiMode || 'openai';
            const baseUrl = um?.baseUrl || 'https://opencode.ai/zen/go/v1/';

            logger.info('request.start', {
                modelId: model.id,
                messageCount: messages.length,
                apiMode,
                baseUrl,
            });

            // Prepare model configuration
            const modelConfig = {
                includeReasoningInRequest: um?.include_reasoning_in_request ?? true,
            };

            // Apply delay between consecutive requests
            const modelDelay = um?.delay;
            const globalDelay = config.get<number>('opencodego.delay', 0);
            const delayMs = modelDelay !== undefined ? modelDelay : globalDelay;

            if (delayMs > 0 && this._lastRequestTime !== null) {
                const elapsed = Date.now() - this._lastRequestTime;
                if (elapsed < delayMs) {
                    const remainingDelay = delayMs - elapsed;
                    logger.debug('request.delay', { delayMs, elapsed, remainingDelay });
                    await new Promise<void>((resolve) => {
                        const timeout = setTimeout(() => {
                            clearTimeout(timeout);
                            resolve();
                        }, remainingDelay);
                    });
                }
            }

            // Get API key
            const modelApiKey = await this.ensureApiKey();
            if (!modelApiKey) {
                logger.warn('apiKey.missing', {});
                throw new Error('OpenCode Go API key not found');
            }

            // Send chat request
            const BASE_URL = baseUrl;
            if (!BASE_URL || !BASE_URL.startsWith('http')) {
                throw new Error('Invalid base URL configuration.');
            }

            // Get retry config
            const retryConfig = createRetryConfig();

            // Create request timeout abort controller (default: 10 minutes)
            requestTimeoutMs = config.get<number>('opencodego.requestTimeout', 600000);
            abortController = new AbortController();
            timeoutId = setTimeout(() => abortController.abort(), requestTimeoutMs);
            token.onCancellationRequested(() => {
                if (!abortController.signal.aborted) {
                    abortController.abort()
                }
            });
            // Create undici fetch with custom bodyTimeout (extends TCP idle timeout during streaming)
            dispatchFetch = fetch

            // Prepare headers with custom headers if specified
            const requestHeaders = CommonApi.prepareHeaders(modelApiKey, apiMode, um?.headers);
            logger.debug('request.headers', {
                headers: logger.sanitizeHeaders(requestHeaders),
            });
            logger.debug('request.messages.origin', { messages });

            if (apiMode === 'anthropic') {
                // Anthropic API mode
                const anthropicApi = new AnthropicApi(model.id);
                const anthropicMessages = anthropicApi.convertMessages(messages, modelConfig);

                // requestBody
                let requestBody: AnthropicRequestBody = {
                    model: um?.id ?? model.id,
                    messages: anthropicMessages,
                    stream: true,
                };
                requestBody = anthropicApi.prepareRequestBody(requestBody, um, options);

                // Build Anthropic messages endpoint URL
                const normalizedBaseUrl = BASE_URL.replace(/\/+$/, '');
                const url = normalizedBaseUrl.endsWith('/v1')
                    ? `${normalizedBaseUrl}/messages`
                    : `${normalizedBaseUrl}/v1/messages`;
                logger.debug('request.body', { url, requestBody });
                const response = await executeWithRetry(async () => {
                    const res = await dispatchFetch(url, {
                        method: 'POST',
                        headers: requestHeaders,
                        body: JSON.stringify(requestBody),
                        signal: abortController.signal,
                    });

                    if (!res.ok) {
                        const errorText = await res.text();
                        console.error('[Anthropic Provider] Anthropic API error response', errorText);
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
                    model: um?.id ?? model.id,
                    messages: openaiMessages,
                    stream: true,
                    stream_options: { include_usage: true },
                };

                requestBody = openaiApi.prepareRequestBody(requestBody, um, options);

                // Send chat request with retry
                const url = `${BASE_URL.replace(/\/+$/, '')}/chat/completions`;
                logger.debug('request.body', { url, requestBody });
                const response = await executeWithRetry(async () => {
                    const res = await dispatchFetch(url, {
                        method: 'POST',
                        headers: requestHeaders,
                        body: JSON.stringify(requestBody),
                        signal: abortController.signal,
                    });

                    if (!res.ok) {
                        const errorText = await res.text();
                        console.error('[OpenCodeGo] API error response', errorText);
                        throw new Error(
                            `API error: [${res.status}] ${res.statusText}${errorText ? `\n${errorText}` : ''}\nURL: ${url}`
                        );
                    }

                    return res;
                }, retryConfig);

                if (!response.body) {
                    throw new Error('No response body from API');
                }

                await openaiApi.processStreamingResponse(response.body, trackingProgress, token);
            }
        } catch (err) {
            // Determine if the request was aborted/terminated (friendly message instead of raw error)
            const errMessage = err instanceof Error ? err.message : String(err);
            const isTimeout = abortController.signal.aborted;
            const isForceTerminated =
                !isTimeout &&
                (errMessage.includes('terminated') ||
                 errMessage.includes('aborted') ||
                 (err instanceof Error && err.name === 'AbortError'));

            if (isTimeout || isForceTerminated) {
                logger.error('request.timeout', {
                    modelId: model.id,
                    timeoutMs: requestTimeoutMs,
                    durationMs: Date.now() - requestStartTime,
                    reason: isForceTerminated ? 'connection_terminated' : 'timeout',
                });
                if (isForceTerminated) {
                    logger.error('request.terminated', { error: 'The connection was closed by the server. The generation took too long. Please try again or request shorter content.' })
                    throw err
                }
                logger.error('request.timeout', { error: 'Request timed out. The generation took too long. You can increase the timeout in settings (opencodego.requestTimeout).' })
                throw err
            }

            console.error('[OpenCodeGo] Chat request failed', {
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

    private async ensureApiKey(): Promise<string | undefined> {
        const session = await vscode.authentication.getSession(openCodeGoAuthServiceId, [], { silent: true })
        if (!session) {
            throw new Error('No authentication session found for ' + openCodeGoAuthServiceId)
        }
        return session.accessToken
    }

}
