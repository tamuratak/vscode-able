import * as vscode from 'vscode'
import { CancellationToken, LanguageModelChatInformation, LanguageModelChatProvider, LanguageModelChatRequestMessage, ProvideLanguageModelChatResponseOptions, LanguageModelResponsePart2, Progress } from 'vscode'
import type { OpenCodeGoModelItem } from './types.js'
import { getBuiltInModelConfig, getBuiltInModelInfos } from './models.js'
import { countMessageTokens } from './provideToken.js'
import { ChatCompletionsResult, OpenaiApi } from './openai/openaiApi.js'
import { AnthropicApi, MessagesResult } from './anthropic/anthropicApi.js'
import type { AnthropicRequestBody } from './anthropic/anthropicTypes.js'
import { CommonApi } from './commonApi.js'
import { logger, messageLogger } from './logger.js'
import { openCodeGoAuthServiceId } from '../../auth/authproviders.js'
import { renderMessages } from '../../utils/renderer.js'
import { tweakSystemPrompt } from './systemprompt.js'
import { pushToolCall, tweakTools } from './tools.js'
import { createDedupProgress, extractLastToolCallSignatures, isToolCallLoopDetected } from './vscodeutils.js'


export class OpenCodeGoChatModelProvider implements LanguageModelChatProvider {
    /** Currently active abort controllers for concurrent requests. */
    private readonly _activeAbortControllers = new Set<AbortController>()

    /** Abort all currently active requests. */
    abortActiveRequests(): void {
        for (const controller of this._activeAbortControllers) {
            controller.abort()
        }
        this._activeAbortControllers.clear()
    }

    async provideLanguageModelChatInformation(): Promise<LanguageModelChatInformation[]> {
        const isApiKeyAvailable = await this.getApiKey()
        if (isApiKeyAvailable) {
            return getBuiltInModelInfos()
        }
        return []
    }

    async provideTokenCount(
        _model: LanguageModelChatInformation,
        text: string | LanguageModelChatRequestMessage
    ): Promise<number> {
        return countMessageTokens(text, { includeReasoningInRequest: true });
    }

    async provideLanguageModelChatResponse(
        model: LanguageModelChatInformation,
        messagesOrigin: readonly LanguageModelChatRequestMessage[],
        optionsOrigin: ProvideLanguageModelChatResponseOptions,
        progressOrigin: Progress<LanguageModelResponsePart2>,
        token: CancellationToken
    ): Promise<void> {
        const [trackingProgress, channel, releaseChannel] = messageLogger.wrapProgress(progressOrigin)
        const dedupProgress = createDedupProgress(trackingProgress, extractLastToolCallSignatures(messagesOrigin))
        const messages = tweakSystemPrompt(model, messagesOrigin, optionsOrigin)
        const options = tweakTools(optionsOrigin)
        channel.append('\n\n\n\n\n\n                ======================= New Request =======================              \n\n\n\n\n\n')
        channel.append(await renderMessages(messages))
        const requestStartTime = Date.now();
        const abortController = new AbortController();
        this._activeAbortControllers.add(abortController)
        const cancelToken = token.onCancellationRequested(() => abortController.abort())

        try {
            const loopInfo = isToolCallLoopDetected(messagesOrigin)
            if (loopInfo.detected) {
                logger.error('[OpenCodeGo] Tool call loop detected, aborting request', {
                    modelId: model.id,
                    callName: loopInfo.callName,
                    repeatCount: loopInfo.repeatCount,
                })
                this.emitToolCallLoopMessage(trackingProgress)
                return
            }

            const umOrig: OpenCodeGoModelItem | undefined = getBuiltInModelConfig(model.id);
            if (!umOrig) {
                logger.error('config.error', { modelId: model.id, error: 'Model configuration not found' });
                throw new Error(`Model configuration not found for model ID: ${model.id}`)
            }
            const um: OpenCodeGoModelItem = { ...umOrig }

            if (options.modelConfiguration?.['reasoningEffort']) {
                const effort = options.modelConfiguration['reasoningEffort'] as unknown
                if (typeof effort === 'string') {
                    if (effort === 'disabled') {
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
            const apiMode = um.apiType
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

            const modelApiKey = await this.getApiKey();
            if (!modelApiKey) {
                logger.error('config.error', { error: 'No authentication session found for ' + openCodeGoAuthServiceId })
                throw new Error('No authentication session found for ' + openCodeGoAuthServiceId)
            }
            const requestHeaders = CommonApi.prepareHeaders(modelApiKey, apiMode, um.headers);
            logger.debug('request.headers', {
                headers: logger.sanitizeHeaders(requestHeaders),
            });
            logger.trace('request.messages.origin', { messages });

            let responseResult: ChatCompletionsResult | MessagesResult | undefined
            if (apiMode === 'messages') {
                // Anthropic API mode
                const anthropicApi = new AnthropicApi(model);
                const anthropicMessages = anthropicApi.convertMessages(messages, modelConfig);

                let requestBody: AnthropicRequestBody = {
                    model: um.id ?? model.id,
                    messages: anthropicMessages,
                    stream: true,
                };
                requestBody = anthropicApi.prepareRequestBody(requestBody, um, options);

                const url = `${BASE_URL}/messages`
                logger.trace('request.body', { url, requestBody })
                const response = await fetch(url, {
                    method: 'POST',
                    headers: requestHeaders,
                    body: JSON.stringify(requestBody),
                    signal: abortController.signal,
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    logger.error('[Anthropic Provider] Anthropic API error response', { errorText });
                    throw new Error(`Anthropic API error: [${response.status}] ${response.statusText}${errorText ? `\n${errorText}` : ''}\nURL: ${url}`)
                }

                if (!response.body) {
                    logger.error('response.error', { modelId: model.id, error: 'No response body from Anthropic API' })
                    throw new Error('No response body from Anthropic API')
                }
                responseResult = await anthropicApi.processStreamingResponse(response.body, dedupProgress, token);
            } else if (apiMode === 'chat-completions') {
                // OpenAI Chat Completions API mode
                const openaiApi = new OpenaiApi(model);
                const openaiMessages = openaiApi.convertMessages(messages, modelConfig);

                // requestBody
                let requestBody: Record<string, unknown> = {
                    model: um.id ?? model.id,
                    messages: openaiMessages,
                    stream: true,
                    stream_options: { include_usage: true },
                }
                requestBody = openaiApi.prepareRequestBody(requestBody, um, options);

                // Send chat request
                const url = `${BASE_URL}/chat/completions`;
                logger.trace('request.body', { url, requestBody });
                const response = await fetch(url, {
                    method: 'POST',
                    headers: requestHeaders,
                    body: JSON.stringify(requestBody),
                    signal: abortController.signal,
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    logger.error('[OpenCodeGo] API error response', { errorText });
                    throw new Error(`API error: [${response.status}] ${response.statusText}${errorText ? `\n${errorText}` : ''}\nURL: ${url}`)
                }

                if (!response.body) {
                    logger.error('response.error', { modelId: model.id, error: 'No response body from API' })
                    throw new Error('No response body from API');
                }

                channel.append('\n\n\n\n\n\n\n                ======================= Progress Assistant Part =======================              \n\n\n\n\n\n')
                responseResult = await openaiApi.processStreamingResponse(response.body, dedupProgress, token);
            } else {
                apiMode satisfies 'responses'
                throw new Error(`Unsupported API mode: ${apiMode}`)
            }
            pushToolCall(model, messages, options, dedupProgress, token, responseResult)
        } catch (err) {
            logger.error('request.error', {
                modelId: model.id,
                messageCount: messages.length,
                errorName: err instanceof Error ? err.name : String(err),
                errorMessage: err instanceof Error ? err.message : String(err),
            });
            throw err;
        } finally {
            releaseChannel()
            cancelToken.dispose()
            this._activeAbortControllers.delete(abortController)
            const durationMs = Date.now() - requestStartTime;
            logger.info('request.end', { modelId: model.id, durationMs });
        }
    }

    private async getApiKey(): Promise<string | undefined> {
        const session = await vscode.authentication.getSession(openCodeGoAuthServiceId, [], { silent: true })
        if (!session) {
            return undefined
        }
        return session.accessToken
    }

    private emitToolCallLoopMessage(progress: Progress<LanguageModelResponsePart2>): void {
        const message = '[VS Code Able] Detected a tool call loop. The response was aborted to prevent an infinite loop. The model may not have enough context to answer this question. Consider asking the user for more information or trying a different approach.'
        progress.report(new vscode.LanguageModelTextPart(message))
    }
}
