import * as vscode from 'vscode'
import { CancellationToken, LanguageModelChatInformation, LanguageModelChatProvider, LanguageModelChatRequestMessage, ProvideLanguageModelChatResponseOptions, LanguageModelResponsePart2, Progress } from 'vscode'
import type { OpenCodeGoModelItem } from './types.js'
import { getBuiltInModelConfig, getBuiltInModelInfos } from './models.js'
import { countMessageTokens } from './provideToken.js'
import { ChatCompletionsResult, OpenaiApi } from './openai/openaiApi.js'
import { OpenaiResponsesApi, ResponsesResult, ResponsesStreamError } from './openai/openaiResponsesApi.js'
import { AnthropicApi, MessagesResult } from './anthropic/anthropicApi.js'
import type { AnthropicRequestBody } from './anthropic/anthropicTypes.js'
import { CommonApi } from './commonApi.js'
import { logger, messageLogger } from './logger.js'
import { openCodeGoAuthServiceId } from '../../auth/authproviders.js'
import { renderMessages } from '../../utils/renderer.js'
import { tweakSystemPrompt } from './systemprompt.js'
import { pushToolCall, tweakTools } from './tools.js'
import { isRetryableError, RETRYABLE_ERROR_MARKER_PREFIX } from './retry.js'
import { createDedupProgress, extractLastToolCallSignatures, isToolCallLoopDetected } from './vscodeutils.js'
import { OPENCODE_SESSION_ID_HEADER, emitSessionIdPart, extractSessionId, stripSessionIdParts } from './sessionid.js'


export class OpenCodeGoChatModelProvider implements LanguageModelChatProvider {
    // Rressing the stop button in the VS Code UI does not propagate cancellation to the
    // underlying fetch token. Without tracking active abort controllers here, there
    // would be no way to cancel in-flight requests from abortActiveRequests().
    private readonly _activeAbortControllers = new Set<AbortController>()

    /** Bound the HTTP connect phase (connect + response headers); the Responses API's streaming phase is bounded by its own timers. */
    private static readonly DEFAULT_HTTP_TIMEOUT_MS = 600_000

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
        // Tool definitions are not counted here: callers (e.g. Copilot's
        // ExtensionContributedChatTokenizer) invoke this per message and per
        // tool field string, and count tool tokens separately. Adding tool
        // tokens here would overcount by (messages x tools) and immediately
        // trigger auto-compaction.
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
        // Persist a stable per-conversation id in the transcript as a
        // standalone assistant part; it is stripped from the model payload
        // and sent as the x-opencode-session header instead, keeping the
        // provider stateless.
        const sessionId = extractSessionId(messages) ?? emitSessionIdPart(dedupProgress)
        const outboundMessages = stripSessionIdParts(messages)
        const requestStartTime = Date.now();
        const abortController = new AbortController();
        this._activeAbortControllers.add(abortController)
        const cancelToken = token.onCancellationRequested(() => abortController.abort())
        let httpTimedOut = false
        // Abort the fetch when the HTTP connect phase stalls; user cancellation
        // and abortActiveRequests() use the same controller.
        const httpTimeoutTimer = setTimeout(() => {
            httpTimedOut = true
            abortController.abort()
        }, OpenCodeGoChatModelProvider.DEFAULT_HTTP_TIMEOUT_MS)

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
            const um: OpenCodeGoModelItem = structuredClone(umOrig)

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
            requestHeaders[OPENCODE_SESSION_ID_HEADER] = sessionId;
            logger.debug('request.headers', {
                headers: logger.sanitizeHeaders(requestHeaders),
            });
            logger.trace('request.messages.origin', { messages });

            let responseResult: ChatCompletionsResult | MessagesResult | ResponsesResult | undefined
            if (apiMode === 'messages') {
                // Anthropic API mode
                const anthropicApi = new AnthropicApi(model);
                const anthropicMessages = anthropicApi.convertMessages(outboundMessages, modelConfig);

                let requestBody: AnthropicRequestBody = {
                    model: um.id ?? model.id,
                    messages: anthropicMessages,
                    stream: true,
                };
                requestBody = anthropicApi.prepareRequestBody(requestBody, um, options);

                const url = `${BASE_URL}/messages`
                logger.trace('request.body', { url, requestBody })
                const body = await anthropicApi.postAndGetBody(url, requestBody, requestHeaders, abortController.signal, 'Anthropic API');
                // The connect phase is over once headers arrive; the streaming
                // phase is bounded by each API's own timers.
                clearTimeout(httpTimeoutTimer)

                channel.append('\n\n\n\n\n\n\n                ======================= Progress Assistant Part =======================              \n\n\n\n\n\n')
                responseResult = await anthropicApi.processStreamingResponse(body, dedupProgress, token);
            } else if (apiMode === 'chat-completions') {
                // OpenAI Chat Completions API mode
                const openaiApi = new OpenaiApi(model);
                const openaiMessages = openaiApi.convertMessages(outboundMessages, modelConfig);

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
                const body = await openaiApi.postAndGetBody(url, requestBody, requestHeaders, abortController.signal, 'API');
                // The connect phase is over once headers arrive; the streaming
                // phase is bounded by each API's own timers.
                clearTimeout(httpTimeoutTimer)

                channel.append('\n\n\n\n\n\n\n                ======================= Progress Assistant Part =======================              \n\n\n\n\n\n')
                responseResult = await openaiApi.processStreamingResponse(body, dedupProgress, token);
            } else if (apiMode === 'responses') {
                // OpenAI Responses API mode
                const openaiResponsesApi = new OpenaiResponsesApi(model);
                const responsesMessages = openaiResponsesApi.convertMessages(outboundMessages, modelConfig);

                // requestBody
                let requestBody: Record<string, unknown> = {
                    model: um.id ?? model.id,
                    input: responsesMessages,
                    stream: true,
                }
                requestBody = openaiResponsesApi.prepareRequestBody(requestBody, um, options);

                // Send responses request
                const url = `${BASE_URL}/responses`;
                logger.trace('request.body', { url, requestBody });
                const body = await openaiResponsesApi.postAndGetBody(url, requestBody, requestHeaders, abortController.signal, 'Responses API');
                // The connect phase is over once headers arrive; the streaming
                // phase is bounded by each API's own timers.
                clearTimeout(httpTimeoutTimer)

                channel.append('\n\n\n\n\n\n\n                ======================= Progress Assistant Part =======================              \n\n\n\n\n\n')
                responseResult = await openaiResponsesApi.processStreamingResponse(body, dedupProgress, token);
            } else {
                // Exhaustiveness guard: fail loudly when a new API mode is added.
                throw new Error(`Unsupported API mode: ${String(apiMode)}`)
            }
            pushToolCall(model, outboundMessages, options, dedupProgress, token, responseResult)
        } catch (err) {
            logger.error('request.error', {
                modelId: model.id,
                messageCount: messages.length,
                errorName: err instanceof Error ? err.name : String(err),
                errorMessage: err instanceof Error ? err.message : String(err),
                errorCode: err instanceof ResponsesStreamError ? err.code : httpTimedOut ? 'http_timeout' : undefined,
            });
            if (isRetryableError(err, httpTimedOut, token)) {
                // End the turn with a retry marker instead of an exception so
                // the assistant message lands in the transcript; the Stop
                // hook then blocks the stop and asks the model to continue.
                const marker = RETRYABLE_ERROR_MARKER_PREFIX + `<!-- ABLE_RETRYABLE_ERROR_${Math.random().toString(16).slice(2, 10).padStart(8, '0')} -->`
                dedupProgress.report(new vscode.LanguageModelTextPart(marker))
                logger.warn('[OpenCodeGo] Retryable request error; emitted retry marker so the task continues', {
                    modelId: model.id,
                    errorName: err instanceof Error ? err.name : String(err),
                })
                return
            }
            throw err;
        } finally {
            clearTimeout(httpTimeoutTimer)
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
