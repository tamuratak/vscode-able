import * as vscode from 'vscode'
import { CancellationToken, LanguageModelChatMessage, LanguageModelChatProvider, LanguageModelDataPart, Progress, LanguageModelTextPart, LanguageModelChatInformation, LanguageModelToolCallPart, LanguageModelResponsePart2, LanguageModelThinkingPart } from 'vscode'
import { LanguageModel, ModelMessage, streamText, ToolSet, tool, jsonSchema } from 'ai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { getNonce } from '../utils/getnonce.js'
import { getValidator, initValidators } from './chatproviderlib/toolcallargvalidator.js'
import { debugObj } from '../utils/debug.js'
import { tokenLength } from './chatproviderlib/openaicompatchatproviderlib/tokencount.js'
import { OpenCodeGoChatConverter } from './opencodegochatproviderlib/converter.js'
import { inspectReadable } from '../utils/inspect.js'
import { openCodeGoAuthServiceId } from '../auth/authproviders.js'
import { renderMessages } from '../utils/renderer.js'


export class OpenCodeGoChatProvider implements LanguageModelChatProvider {
    readonly serviceName = 'OpenCodeGoChatProvider'
    readonly categoryLabel = 'OpenCode Go (with Able)'
    readonly apiBaseUrl = 'https://opencode.ai/zen/go/v1/'
    private readonly authServiceId = openCodeGoAuthServiceId
    private readonly converter: OpenCodeGoChatConverter
    private readonly callIdToolNameMap = new Map<string, string>()

    constructor(
        private readonly extension: {
            readonly outputChannel: vscode.LogOutputChannel,
        }
    ) {
        this.converter = new OpenCodeGoChatConverter(extension, this.callIdToolNameMap)
        setTimeout(() => this.extension.outputChannel.info(this.serviceName + ': OpenCodeGoChatProvider initialized'), 0)
        console.log('OpenCodeGoChatProvider initialized')
    }

    private generateCallId(): string {
        return 'call_' + getNonce(16)
    }

    provideLanguageModelChatInformation(): LanguageModelChatInformation[] {
        return [
            {
                id: 'glm-5.1',
                name: 'GLM-5.1',
                family: 'GLM',
                version: 'glm-5.1',
                detail: 'OpenCode Go',
                capabilities: {
                    toolCalling: true,
                    imageInput: false,
                },
                maxInputTokens: 200000,
                maxOutputTokens: 131072,
                isUserSelectable: true
            },
            {
                id: 'glm-5',
                name: 'GLM-5',
                family: 'GLM',
                version: 'glm-5',
                detail: 'OpenCode Go',
                capabilities: {
                    toolCalling: true,
                    imageInput: false,
                },
                maxInputTokens: 200000,
                maxOutputTokens: 131072,
                isUserSelectable: true
            },
            {
                id: 'kimi-k2.5',
                name: 'Kimi K2.5',
                family: 'Kimi',
                version: 'kimi-k2.5',
                detail: 'OpenCode Go',
                capabilities: {
                    toolCalling: true,
                    imageInput: true
                },
                maxInputTokens: 262144,
                maxOutputTokens: 16384,
                isUserSelectable: true
            },
            {
                id: 'kimi-k2.6',
                name: 'Kimi K2.6',
                family: 'Kimi',
                version: 'kimi-k2.6',
                detail: 'OpenCode Go',
                capabilities: {
                    toolCalling: true,
                    imageInput: true
                },
                maxInputTokens: 262144,
                maxOutputTokens: 16384,
                isUserSelectable: true
            },
            {
                id: 'deepseek-v4-pro',
                name: 'DeepSeek V4 Pro',
                family: 'DeepSeek',
                version: 'deepseek-v4-pro',
                detail: 'OpenCode Go',
                capabilities: {
                    toolCalling: true,
                    imageInput: false
                },
                maxInputTokens: 1000000,
                maxOutputTokens: 393216,
                isUserSelectable: true
            },
            {
                id: 'deepseek-v4-flash',
                name: 'DeepSeek V4 Flash',
                family: 'DeepSeek',
                version: 'deepseek-v4-flash',
                detail: 'OpenCode Go',
                capabilities: {
                    toolCalling: true,
                    imageInput: false
                },
                maxInputTokens: 1000000,
                maxOutputTokens: 393216,
            },
            {
                id: 'mimo-v2-pro',
                name: 'MiMo-V2-Pro',
                family: 'MiMo',
                version: 'mimo-v2-pro',
                detail: 'OpenCode Go',
                capabilities: {
                    toolCalling: true,
                    imageInput: false
                },
                maxInputTokens: 262144,
                maxOutputTokens: 32768,
                isUserSelectable: true
            },
            {
                id: 'mimo-v2-omni',
                name: 'MiMo-V2-Omni',
                family: 'MiMo',
                version: 'mimo-v2-omni',
                detail: 'OpenCode Go',
                capabilities: {
                    toolCalling: true,
                    imageInput: true
                },
                maxInputTokens: 262144,
                maxOutputTokens: 32768,
                isUserSelectable: true
            },
            {
                id: 'mimo-v2.5-pro',
                name: 'MiMo-V2.5-Pro',
                family: 'MiMo',
                version: 'mimo-v2.5-pro',
                detail: 'OpenCode Go',
                capabilities: {
                    toolCalling: true,
                    imageInput: false
                },
                maxInputTokens: 262144,
                maxOutputTokens: 32768,
                isUserSelectable: true
            },
            {
                id: 'mimo-v2.5',
                name: 'MiMo-V2.5',
                family: 'MiMo',
                version: 'mimo-v2.5',
                detail: 'OpenCode Go',
                capabilities: {
                    toolCalling: true,
                    imageInput: false
                },
                maxInputTokens: 262144,
                maxOutputTokens: 32768,
                isUserSelectable: true
            }
        ]

    }

    async provideLanguageModelChatResponse(
        modelInfo: LanguageModelChatInformation,
        messages: (LanguageModelChatMessage | vscode.LanguageModelChatMessage2)[],
        options: vscode.ProvideLanguageModelChatResponseOptions,
        progress: Progress<LanguageModelResponsePart2>,
        token: CancellationToken
    ): Promise<void> {
        const session = await vscode.authentication.getSession(this.authServiceId, [], { silent: true })
        if (!session) {
            throw new Error('No authentication session found for ' + this.authServiceId)
        }
        const apiKey = session.accessToken
        initValidators(options.tools)
        const provider = createOpenAICompatible({
            name: this.serviceName,
            apiKey,
            baseURL: this.apiBaseUrl
        })
        const model = provider.languageModel(modelInfo.id)
        debugObj('OpenCode Go (with Able) messages:\n', () => renderMessages(messages), this.extension.outputChannel)
        debugObj('apiBaseUrl: ', this.apiBaseUrl, this.extension.outputChannel)
        await this.completionsApiCall(model, messages, options, progress, token)
    }

    async completionsApiCall(
        model: LanguageModel,
        messages: (LanguageModelChatMessage | vscode.LanguageModelChatMessage2)[],
        options: vscode.ProvideLanguageModelChatResponseOptions,
        progress: Progress<LanguageModelResponsePart2>,
        token: CancellationToken
    ) {
        const chatMessages: ModelMessage[]
            = (await Promise.all(messages.map(m => this.converter.toChatCompletionMessageParam(m)))).flat()
        const toolSet: ToolSet = {}
        if (options.tools) {
            for (const tl of options.tools) {
                toolSet[tl.name] = tool({
                    description: tl.description,
                    inputSchema: jsonSchema(tl.inputSchema),
                })
            }
        }
        const toolChoiceFlag = options.tools && options.tools.length > 0
        const toolChoice = options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : (toolChoiceFlag ? 'auto' : 'none')
        await this.createStream(model, chatMessages, toolSet, toolChoice, progress, token)
    }

    private async createStream(
        model: LanguageModel,
        messages: ModelMessage[],
        tools: ToolSet,
        toolChoice: 'required' | 'auto' | 'none',
        progress: Progress<LanguageModelResponsePart2>,
        token: CancellationToken
    ) {
        let allContent = ''
        const abortController = new AbortController()
        const disposable = token.onCancellationRequested(() => abortController.abort())
        try {
            const stream = streamText({
                model,
                prompt: messages,
                tools,
                toolChoice,
                providerOptions: {
                    openaiCompatible: {
                        reasoningEffort: 'low',
                    }
                },
                abortSignal: abortController.signal
            })
            let status: 'text' | 'reasoning' | 'tool-call' | undefined = undefined
            console.log(status)
            let reasoningContent = ''
            let toolCall = {
                name: '',
                callId: '',
                input: ''
            }
            for await (const chunk of stream.fullStream) {
                if (chunk.type === 'text-start') {
                    status = 'text'
                } else if (chunk.type === 'text-delta') {
                    allContent += chunk.text
                    this.reportContent(chunk.text, progress)
                } else if (chunk.type === 'text-end') {
                    status = undefined
                } else if (chunk.type === 'reasoning-start') {
                    status = 'reasoning'
                } else if (chunk.type === 'reasoning-delta') {
                    reasoningContent += chunk.text
                } else if (chunk.type === 'reasoning-end') {
                    status = undefined
                    reasoningContent = ''
                    progress.report(new LanguageModelThinkingPart(reasoningContent, chunk.id))
                } else if (chunk.type === 'tool-input-start') {
                    status = 'tool-call'
                    toolCall.name = chunk.toolName
                } else if (chunk.type === 'tool-input-delta') {
                    toolCall.input += chunk.delta
                } else if (chunk.type === 'tool-input-end') {
                    this.reportToolCall(toolCall, progress)
                    toolCall = {
                        name: '',
                        callId: '',
                        input: ''
                    }
                    status = undefined
                } else {
                    debugObj('Unhandled chunk type: ', chunk, this.extension.outputChannel)
                    // chunk.type
                }
            }
        } catch (e) {
            debugObj('Error in OpenCodeGoChatProvider stream: ', e, this.extension.outputChannel)
        } finally {
            disposable.dispose()
        }
        debugObj('Chat reply: ', allContent, this.extension.outputChannel)
    }

    private reportContent(content: string | null | undefined, progress: Progress<LanguageModelTextPart | LanguageModelToolCallPart | LanguageModelDataPart>) {
        if (content) {
            progress.report(new LanguageModelTextPart(content))
        }
    }

    private reportToolCall(
        toolCall: { name: string; callId: string; input: string },
        progress: Progress<LanguageModelTextPart | LanguageModelToolCallPart | LanguageModelDataPart>
    ) {
        if (toolCall.name === undefined || toolCall.input === undefined) {
            return
        }
        const callId = toolCall.callId ?? this.generateCallId()
        let args: object
        try {
            if (toolCall.input === '') {
                args = {}
            } else {
                args = JSON.parse(toolCall.input) as object
            }
        } catch (e) {
            this.extension.outputChannel.error(`Failed to parse tool call arguments: ${toolCall.input}. Error: ${e instanceof Error ? e.message : inspectReadable(e)}`)
            return
        }
        const validator = getValidator(toolCall.name)
        if (validator === undefined) {
            this.extension.outputChannel.error(`No validator found for tool call: ${toolCall.name}`)
            throw new Error(`No validator found for tool call: ${toolCall.name}`)
        }
        if (!validator(args)) {
            this.extension.outputChannel.error(`Invalid tool call arguments for ${toolCall.name}: ${JSON.stringify(args)}`)
            debugObj('Validation errors: ', validator.errors, this.extension.outputChannel)
            throw new Error(`Invalid tool call arguments for ${toolCall.name}: ${JSON.stringify(args)}`)
        }
        progress.report(new LanguageModelToolCallPart(callId, toolCall.name, args))
    }

    async provideTokenCount(_model: LanguageModelChatInformation, text: string | LanguageModelChatMessage | vscode.LanguageModelChatMessage2): Promise<number> {
        return tokenLength(text)
    }

}
