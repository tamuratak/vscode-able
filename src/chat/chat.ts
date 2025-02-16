import * as vscode from 'vscode'
import { FluentJaPrompt, FluentPrompt, HistoryEntry, InputProps, SimplePrompt, ToEnPrompt, ToJaPrompt } from './prompt.js'
import { PromptElementCtor, renderPrompt } from '@vscode/prompt-tsx'
import { ExternalPromise } from '../utils/externalpromise.js'
import { OpenAI } from 'openai'
import { Gpt4oTokenizer } from './tokenizer.js'
import { convertToChatCompletionMessageParams, extractAbleHistory, getSelectedText } from './chatlib/utils.js'
import type { Stream } from 'openai/streaming.mjs'


export type RequestCommands = 'fluent' | 'fluent_ja' | 'to_en' | 'to_ja' | 'use_copilot' | 'use_openai_api'

enum ChatVendor {
    Copilot = 'copilot',
    OpenAiApi = 'openai_api',
}

export class ChatHandler {
    private readonly gpt4oTokenizer = new Gpt4oTokenizer()
    private readonly gpt4omini = new ExternalPromise<vscode.LanguageModelChat>()
    private readonly openAiClient = new ExternalPromise<OpenAI>()
    private vendor = ChatVendor.Copilot

    constructor(public readonly openAiServiceId: string) { }

    async initGpt4oMini() {
        const [mini,] = await vscode.lm.selectChatModels({
            vendor: 'copilot',
            family: 'gpt-4o-mini'
        })
        if (mini) {
            console.log('GPT-4o Mini model loaded')
            this.gpt4omini.resolve(mini)
        } else {
            const message = 'Failed to load GPT-4o Mini model'
            void vscode.window.showErrorMessage(message)
            console.error(message)
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
            const {chatResponse} = await this.copilotChatResponse(token, request, ctor, ableHistory, stream, model)
            if (chatResponse) {
                for await (const fragment of chatResponse.text) {
                    responseText += fragment
                }
            }
        } else {
            const {chatResponse} = await this.openAiGpt4oMiniResponse(token, request, ctor, ableHistory, stream)
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
            tools.push({ name: ablePython.name, description: ablePython.description, inputSchema: ablePython.inputSchema})
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
            if (!this.gpt4omini.isResolved) {
                void vscode.window.showErrorMessage('GPT-4o Mini model is not loaded. Execute the activation command.')
                throw new Error('GPT-4o Mini model is not loaded')
            }
            model = await this.gpt4omini.promise
        }
        const { messages } = await renderPrompt(ctor, { history: ableHistory, input: request.prompt }, { modelMaxPromptTokens: 1024 }, model)
        const tools = this.getLmTools()
        const chatResponse = await model.sendRequest(messages, { tools }, token)
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
                const result = await vscode.lm.invokeTool(fragment.name, { input: fragment.input, toolInvocationToken: request.toolInvocationToken }, token)
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
            const mess = new vscode.LanguageModelTextPart('Above is the result of calling one or more tools. Answer using the natural language of the user.')
            newMessages.push(vscode.LanguageModelChatMessage.User([mess]))
            const chatResponse2 = await model.sendRequest(newMessages, { tools }, token)
            await this.processChatResponse(chatResponse2, newMessages, token, request, stream, tools, model)
        }
    }


    private async openAiGpt4oMiniResponse<S>(
        token: vscode.CancellationToken,
        request: vscode.ChatRequest,
        ctor: PromptElementCtor<InputProps, S>,
        ableHistory: HistoryEntry[],
        stream?: vscode.ChatResponseStream
    ) {
        let client: OpenAI
        if (this.openAiClient.isResolved) {
            client = await this.openAiClient.promise
        } else {
            const session = await vscode.authentication.getSession(this.openAiServiceId, [], { createIfNone: true })
            client = new OpenAI({ apiKey: session.accessToken })
            this.openAiClient.resolve(client)
        }
        const renderResult = await renderPrompt(ctor, { history: ableHistory, input: request.prompt }, { modelMaxPromptTokens: 1024 }, this.gpt4oTokenizer, undefined, undefined, 'none')
        const systemMessage = { role: 'system', content: 'When answering a question that requires executing Python code, use able_python.' } as const
        const messages = [systemMessage, ...convertToChatCompletionMessageParams(renderResult.messages)]
        const abortController = new AbortController()
        const signal = abortController.signal
        token.onCancellationRequested(() => abortController.abort())
        const tools: OpenAI.ChatCompletionTool[] = []
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
        const chatResponse = await client.chat.completions.create({ messages, model: 'gpt-4o-mini', max_completion_tokens: 2048, n: 1, stream: true, tools }, { signal })
        if (stream) {
            await this.processOpenAiResponse(chatResponse, messages, token, request, stream, tools, signal)
            return {chatResponse: undefined}
        } else {
            return {chatResponse}
        }
    }

    private async processOpenAiResponse(
        chatResponse: Stream<OpenAI.Chat.Completions.ChatCompletionChunk>,
        messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        token: vscode.CancellationToken,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        tools: OpenAI.Chat.Completions.ChatCompletionTool[],
        signal: AbortSignal
    ) {
        const newMessages = [...messages]
        let responseStr = ''
        const toolCalls: NonNullToolCall[] = []
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
                    const {index} = toolCall
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
            newMessages.push({role: 'assistant', content: responseStr})
            for (const fragment of toolCalls) {
                const frag = { function: { name: fragment.function.name, arguments: fragment.function.arguments }, id: fragment.id, type: 'function' as const }
                const input = JSON.parse(fragment.function.arguments) as Record<string, unknown>
                const result = await vscode.lm.invokeTool(fragment.function.name, { input, toolInvocationToken: request.toolInvocationToken }, token)
                const ret: string[] = []
                for (const part of result.content) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        ret.push(part.value)
                    }
                }
                newMessages.push({role: 'assistant', content: '', tool_calls: [frag]})
                newMessages.push({ role: 'tool', content: ret.join(''), tool_call_id: fragment.id })
            }
            const client = await this.openAiClient.promise
            const chatResponse2 = await client.chat.completions.create({ messages: newMessages, model: 'gpt-4o-mini', max_completion_tokens: 2048, n: 1, stream: true, tools }, { signal })
            await this.processOpenAiResponse(chatResponse2, newMessages, token, request, stream, tools, signal)
        }
    }

}

interface NonNullToolCall {
    function: {
        name: string
        arguments: string
    }
    id: string
    type: string
}
