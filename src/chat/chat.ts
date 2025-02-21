import * as vscode from 'vscode'
import { FluentJaPrompt, FluentPrompt, HistoryEntry, InputProps, SimplePrompt, ToEnPrompt, ToJaPrompt, ToolResultDirectivePrompt } from './prompt.js'
import { type PromptElementCtor, renderPrompt, type ToolCall } from '@vscode/prompt-tsx'
import { ExternalPromise } from '../utils/externalpromise.js'
import { OpenAI } from 'openai'
import { Gpt4oTokenizer } from './tokenizer.js'
import { convertToChatCompletionMessageParams, extractAbleHistory, getSelectedText } from './chatlib/utils.js'
import type { Stream } from 'openai/streaming.mjs'
import type { ChatCompletionChunk, ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/index.mjs'


export type RequestCommands = 'fluent' | 'fluent_ja' | 'to_en' | 'to_ja' | 'use_copilot' | 'use_openai_api'

enum ChatVendor {
    Copilot = 'copilot',
    OpenAiApi = 'openai_api',
}

export class ChatHandler {
    private readonly gpt4oTokenizer = new Gpt4oTokenizer()
    private copilotModel: vscode.LanguageModelChat | undefined
    private readonly openAiClient = new ExternalPromise<OpenAI>()
    private vendor = ChatVendor.Copilot
    private readonly outputChannel = vscode.window.createOutputChannel('vscode-able-chat', { log: true })

    constructor(public readonly openAiServiceId: string) {
        this.outputChannel.info('ChatHandler initialized')
    }

    async initGpt4oMini() {
        const [mini,] = await vscode.lm.selectChatModels({
            vendor: 'copilot',
            family: 'gpt-4o-mini'
        })
        if (mini) {
            this.outputChannel.info('GPT-4o Mini model loaded')
            this.copilotModel = mini
        } else {
            const message = 'Failed to load GPT-4o Mini model'
            void vscode.window.showErrorMessage(message)
            this.outputChannel.error(message)
        }
    }

    async quickPickModel() {
        try {
            const models = await vscode.lm.selectChatModels({ vendor: 'copilot' })
            if (models.length === 0) {
                void vscode.window.showErrorMessage('No chat models found')
                return
            }
            const generatedItems = models.map(model => ({ label: model.family, model }))
            const items = [{ label: 'openai-gpt-4o-mini', model: undefined }, ...generatedItems]

            const quickPick = vscode.window.createQuickPick<typeof items[0]>()
            quickPick.items = items
            quickPick.placeholder = 'Select chat model'
            if (this.copilotModel) {
                quickPick.activeItems = items.filter(i => i.label === this.copilotModel?.family)
            }

            const selectionPromise = new Promise<typeof items[0] | undefined>((resolve) => {
                quickPick.onDidAccept(() => {
                    resolve(quickPick.selectedItems[0])
                    quickPick.hide()
                })
                quickPick.onDidHide(() => {
                    resolve(undefined)
                })
            })
            quickPick.show()

            const selection = await selectionPromise
            if (!selection) {
                return
            }
            if (selection.model) {
                this.copilotModel = selection.model
                this.vendor = ChatVendor.Copilot
            } else if (selection.label === 'openai-gpt-4o-mini') {
                this.copilotModel = undefined
                this.vendor = ChatVendor.OpenAiApi
                await this.resolveOpenAiClient()
            } else {
                void vscode.window.showErrorMessage('Invalid selection')
                return
            }
            this.outputChannel.info(`Model selected: ${selection.label}`)
        } catch (error) {
            if (error instanceof Error) {
                this.outputChannel.error(error)
            }
            void vscode.window.showErrorMessage('Failed to select chat model')
        }
    }

    getHandler(): vscode.ChatRequestHandler {
        return async (
            request: vscode.ChatRequest,
            context: vscode.ChatContext,
            stream: vscode.ChatResponseStream,
            token: vscode.CancellationToken
        ) => {
            const ableHistory = extractAbleHistory(context)
            if (request.command === 'fluent') {
                const response = await this.responseWithSelection(token, request, FluentPrompt, ableHistory)
                stream.markdown(response)
                return
            } else if (request.command === 'fluent_ja') {
                const response = await this.responseWithSelection(token, request, FluentJaPrompt, ableHistory)
                stream.markdown(response)
                return
            } if (request.command === 'to_en') {
                const response = await this.responseWithSelection(token, request, ToEnPrompt, ableHistory)
                stream.markdown(response)
                return
            } else if (request.command === 'to_ja') {
                const response = await this.responseWithSelection(token, request, ToJaPrompt, ableHistory)
                stream.markdown(response)
                return
            } else if (request.command === 'use_copilot') {
                this.vendor = ChatVendor.Copilot
                stream.markdown('Changed the chat vendor to Copilot')
            } else if (request.command === 'use_openai_api') {
                this.vendor = ChatVendor.OpenAiApi
                stream.markdown('Changed the chat vendor to OpenAI API')
            } else {
                if (this.vendor === ChatVendor.Copilot) {
                    await this.copilotChatResponse(token, request, SimplePrompt, ableHistory, stream)
                } else {
                    await this.openAiGpt4oMiniResponse(token, request, SimplePrompt, ableHistory, stream)
                }
            }
        }
    }

    private async responseWithSelection<S>(
        token: vscode.CancellationToken,
        request: vscode.ChatRequest,
        ctor: PromptElementCtor<InputProps, S>,
        ableHistory: HistoryEntry[],
        stream?: vscode.ChatResponseStream,
        model?: vscode.LanguageModelChat
    ) {
        const selectedText = await getSelectedText(request)
        const input = selectedText ?? request.prompt
        let responseText = ''
        if (this.vendor === ChatVendor.Copilot) {
            const { chatResponse } = await this.copilotChatResponse(token, request, ctor, ableHistory, stream, model)
            if (chatResponse) {
                for await (const fragment of chatResponse.text) {
                    responseText += fragment
                }
            }
        } else {
            const { chatResponse } = await this.openAiGpt4oMiniResponse(token, request, ctor, ableHistory, stream)
            if (chatResponse) {
                for await (const fragment of chatResponse) {
                    responseText += fragment.choices[0]?.delta?.content ?? ''
                }
            }
        }
        if (selectedText) {
            return '#### input\n' + input + '\n\n' + '#### output\n' + responseText
        } else {
            return responseText
        }
    }

    private getLmTools() {
        const tools: vscode.LanguageModelChatTool[] = []
        const ablePython = vscode.lm.tools.find(tool => tool.name === 'able_python')
        if (ablePython && ablePython.inputSchema) {
            tools.push({ name: ablePython.name, description: ablePython.description, inputSchema: ablePython.inputSchema })
        }
        return tools
    }

    private async copilotChatResponse<S>(
        token: vscode.CancellationToken,
        request: vscode.ChatRequest,
        ctor: PromptElementCtor<InputProps, S>,
        ableHistory: HistoryEntry[],
        stream?: vscode.ChatResponseStream,
        model?: vscode.LanguageModelChat,
    ) {
        if (!model) {
            if (!this.copilotModel) {
                void vscode.window.showErrorMessage('GPT-4o Mini model is not loaded. Execute the activation command.')
                throw new Error('GPT-4o Mini model is not loaded')
            }
            model = this.copilotModel
        }
        const { messages } = await renderPrompt(ctor, { history: ableHistory, input: request.prompt }, { modelMaxPromptTokens: 2048 }, model)
        const tools = this.getLmTools()
        const chatResponse = await model.sendRequest(
            messages, { tools }, token
        ).then(r => r, e => {
            if (e instanceof Error) {
                this.outputChannel.error(e, messages)
            }
            throw e
        })
        if (stream) {
            await this.processChatResponse(chatResponse, messages, token, request, stream, tools, model)
            return { chatResponse: undefined, messages: undefined, tools, model }
        } else {
            return { chatResponse, messages, tools, model }
        }
    }

    private async processChatResponse(
        chatResponse: vscode.LanguageModelChatResponse,
        messages: vscode.LanguageModelChatMessage[],
        token: vscode.CancellationToken,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        tools: vscode.LanguageModelChatTool[],
        model: vscode.LanguageModelChat,
    ): Promise<void> {
        const newMessages = [...messages]
        let responseStr = ''
        const toolCalls: vscode.LanguageModelToolCallPart[] = []
        for await (const fragment of chatResponse.stream) {
            if (fragment instanceof vscode.LanguageModelTextPart) {
                stream.markdown(fragment.value)
                responseStr += fragment.value
            } else if (fragment instanceof vscode.LanguageModelToolCallPart) {
                if (fragment.name === 'able_python') {
                    toolCalls.push(fragment)
                }
            }
        }
        if (toolCalls.length > 0) {
            newMessages.push(vscode.LanguageModelChatMessage.Assistant(responseStr))
            for (const fragment of toolCalls) {
                const result = await vscode.lm.invokeTool(
                    fragment.name,
                    { input: fragment.input, toolInvocationToken: request.toolInvocationToken }, token
                ).then(r => r, e => {
                    if (e instanceof Error) {
                        this.outputChannel.error(e, fragment)
                    } else {
                        this.outputChannel.error('Unknown error', e, fragment)
                    }
                    return undefined
                })
                if (result === undefined) {
                    continue
                }
                const ret: string[] = []
                for (const part of result.content) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        ret.push(part.value)
                    }
                }
                const toolResultPart = new vscode.LanguageModelToolResultPart(fragment.callId, [new vscode.LanguageModelTextPart(ret.join(''))])
                newMessages.push(
                    vscode.LanguageModelChatMessage.Assistant([fragment]),
                    vscode.LanguageModelChatMessage.User([toolResultPart]),
                )
            }
            const directive = await renderPrompt(ToolResultDirectivePrompt, { messages: newMessages }, { modelMaxPromptTokens: 2048 }, model)
            const chatResponse2 = await model.sendRequest(
                directive.messages, { tools }, token
            ).then(r => r, e => {
                if (e instanceof Error) {
                    this.outputChannel.error(e, directive.messages)
                }
                throw e
            })
            await this.processChatResponse(chatResponse2, directive.messages, token, request, stream, tools, model)
        }
    }


    private async resolveOpenAiClient() {
        if (!this.openAiClient.isResolved) {
            const session = await vscode.authentication.getSession(this.openAiServiceId, [], { createIfNone: true })
            const client = new OpenAI({ apiKey: session.accessToken })
            this.openAiClient.resolve(client)
        }
        return this.openAiClient.promise
    }

    private async openAiGpt4oMiniResponse<S>(
        token: vscode.CancellationToken,
        request: vscode.ChatRequest,
        ctor: PromptElementCtor<InputProps, S>,
        ableHistory: HistoryEntry[],
        stream?: vscode.ChatResponseStream
    ) {
        const client = await this.resolveOpenAiClient()
        const renderResult = await renderPrompt(ctor, { history: ableHistory, input: request.prompt }, { modelMaxPromptTokens: 2048 }, this.gpt4oTokenizer, undefined, undefined, 'none')
        const messages = convertToChatCompletionMessageParams(renderResult.messages)
        const abortController = new AbortController()
        const signal = abortController.signal
        token.onCancellationRequested(() => abortController.abort())
        const tools: ChatCompletionTool[] = []
        for (const tool of this.getLmTools()) {
            if (tool.inputSchema) {
                tools.push({
                    type: 'function',
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.inputSchema as Record<string, unknown>,
                    }
                })
            }
        }
        const chatResponse = await client.chat.completions.create(
            { messages, model: 'gpt-4o-mini', max_completion_tokens: 2048, n: 1, stream: true, tools }, { signal }
        ).then(r => r, e => {
            if (e instanceof Error) {
                this.outputChannel.error(e, messages)
            }
            throw e
        })
        if (stream) {
            await this.processOpenAiResponse(chatResponse, messages, token, request, stream, tools, signal)
            return { chatResponse: undefined }
        } else {
            return { chatResponse }
        }
    }

    private async processOpenAiResponse(
        chatResponse: Stream<ChatCompletionChunk>,
        messages: ChatCompletionMessageParam[],
        token: vscode.CancellationToken,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        tools: ChatCompletionTool[],
        signal: AbortSignal
    ) {
        const newMessages = [...messages]
        let responseStr = ''
        const toolCalls: ToolCall[] = []
        for await (const fragment of chatResponse) {
            const choice = fragment.choices[0]
            if (choice.delta.content) {
                stream.markdown(choice.delta.content)
                responseStr += choice.delta.content
            } else if (choice.delta.tool_calls) {
                for (const toolCall of choice.delta.tool_calls) {
                    if (!toolCall.function) {
                        continue
                    }
                    const { index } = toolCall
                    if (toolCalls[index]) {
                        toolCalls[index].function.arguments += toolCall.function.arguments
                    } else {
                        if (toolCall.function?.name && toolCall.id && toolCall.type) {
                            toolCalls[index] = { function: { name: toolCall.function.name, arguments: toolCall.function.arguments ?? '' }, id: toolCall.id, type: toolCall.type }
                        }
                    }

                }
            }
        }
        if (toolCalls.length > 0) {
            newMessages.push({ role: 'assistant', content: responseStr })
            for (const fragment of toolCalls) {
                const frag = { function: { name: fragment.function.name, arguments: fragment.function.arguments }, id: fragment.id, type: 'function' as const }
                const input = JSON.parse(fragment.function.arguments) as Record<string, unknown>
                const result = await vscode.lm.invokeTool(
                    fragment.function.name, { input, toolInvocationToken: request.toolInvocationToken }, token
                ).then(r => r, e => {
                    if (e instanceof Error) {
                        this.outputChannel.error(e, fragment)
                    } else {
                        this.outputChannel.error('Unknown error', e, fragment)
                    }
                    return undefined
                })
                if (result === undefined) {
                    continue
                }
                const ret: string[] = []
                for (const part of result.content) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        ret.push(part.value)
                    }
                }
                newMessages.push({ role: 'assistant', content: '', tool_calls: [frag] })
                newMessages.push({ role: 'tool', content: ret.join(''), tool_call_id: fragment.id })
            }
            const client = await this.openAiClient.promise
            const chatResponse2 = await client.chat.completions.create(
                { messages: newMessages, model: 'gpt-4o-mini', max_completion_tokens: 2048, n: 1, stream: true, tools }, { signal }
            ).then(r => r, e => {
                if (e instanceof Error) {
                    this.outputChannel.error(e, newMessages)
                }
                throw e
            })
            await this.processOpenAiResponse(chatResponse2, newMessages, token, request, stream, tools, signal)
        }
    }

}
