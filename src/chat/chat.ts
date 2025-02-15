import * as vscode from 'vscode'
import { FluentJaPrompt, FluentPrompt, HistoryEntry, InputProps, SimplePrompt, ToEnPrompt, ToJaPrompt } from './prompt.js'
import { ChatMessage, ChatRole, PromptElementCtor, renderPrompt } from '@vscode/prompt-tsx'
import { ExternalPromise } from '../utils/externalpromise.js'
import { OpenAI } from 'openai'
import { Gpt4oTokenizer } from './tokenizer.js'
import type { ChatCompletionMessageParam } from 'openai/resources/index'
import { extractAbleHistory, getSelectedText } from './chatlib/utils.js'


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
                const response = await this.responseWithSelection(token, request, FluentPrompt, ableHistory, stream)
                stream.markdown(response)
                return
            } else if (request.command === 'fluent_ja') {
                const response = await this.responseWithSelection(token, request, FluentJaPrompt, ableHistory, stream)
                stream.markdown(response)
                return
            } if (request.command === 'to_en') {
                const response = await this.responseWithSelection(token, request, ToEnPrompt, ableHistory, stream)
                stream.markdown(response)
                return
            } else if (request.command === 'to_ja') {
                const response = await this.responseWithSelection(token, request, ToJaPrompt, ableHistory, stream)
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
                    const chatResponse = await this.openAiGpt4oMiniResponse(token, request.prompt, SimplePrompt, ableHistory)
                    stream.markdown(chatResponse.choices[0]?.message.content ?? '')
                }
            }
        }
    }

    private async responseWithSelection<S>(
        token: vscode.CancellationToken,
        request: vscode.ChatRequest,
        ctor: PromptElementCtor<InputProps, S>,
        ableHistory: HistoryEntry[],
        stream: vscode.ChatResponseStream,
        model?: vscode.LanguageModelChat
    ) {
        const selectedText = await getSelectedText(request)
        const input = selectedText ?? request.prompt
        let responseText = ''
        if (this.vendor === ChatVendor.Copilot) {
            await this.copilotChatResponse(token, request, ctor, ableHistory, stream, model)
        } else {
            const chatResponse = await this.openAiGpt4oMiniResponse(token, input, ctor, ableHistory)
            responseText = chatResponse.choices[0]?.message.content ?? ''
        }
        if (selectedText) {
            return '#### input\n' + input + '\n\n' + '#### output\n' + responseText
        } else {
            return responseText
        }
    }

    private async copilotChatResponse<S>(
        token: vscode.CancellationToken,
        request: vscode.ChatRequest,
        ctor: PromptElementCtor<InputProps, S>,
        ableHistory: HistoryEntry[],
        stream: vscode.ChatResponseStream,
        model?: vscode.LanguageModelChat,
    ) {
        if (!model) {
            if (!this.gpt4omini.isResolved) {
                void vscode.window.showErrorMessage('GPT-4o Mini model is not loaded. Execute the activation command.')
                return
            }
            model = await this.gpt4omini.promise
        }
        const { messages } = await renderPrompt(ctor, { history: ableHistory, input: request.prompt }, { modelMaxPromptTokens: 1024 }, model)
        const tools: vscode.LanguageModelChatTool[] = []
        const ablePython = vscode.lm.tools.find(tool => tool.name === 'able_python')
        if (ablePython && ablePython.inputSchema) {
            tools.push({ name: ablePython.name, description: ablePython.description, inputSchema: ablePython.inputSchema})
        }
        const chatResponse = await model.sendRequest(messages, { tools }, token)
        return this.processChatResponse(chatResponse, messages, token, request, stream, tools, model)
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
        input: string,
        ctor: PromptElementCtor<InputProps, S>,
        ableHistory: HistoryEntry[],
    ) {
        let client: OpenAI
        if (this.openAiClient.isResolved) {
            client = await this.openAiClient.promise
        } else {
            const session = await vscode.authentication.getSession(this.openAiServiceId, [], { createIfNone: true })
            client = new OpenAI({ apiKey: session.accessToken })
            this.openAiClient.resolve(client)
        }
        const renderResult = await renderPrompt(ctor, { history: ableHistory, input }, { modelMaxPromptTokens: 1024 }, this.gpt4oTokenizer, undefined, undefined, 'none')
        const messages = this.convertToChatCompletionMessageParams(renderResult.messages)
        const abortController = new AbortController()
        const signal = abortController.signal
        token.onCancellationRequested(() => abortController.abort())
        const chatResponse = await client.chat.completions.create({ messages, model: 'gpt-4o-mini', max_tokens: 1024, n: 1 }, { signal })
        return chatResponse
    }

    private convertToChatCompletionMessageParams(messages: ChatMessage[]): ChatCompletionMessageParam[] {
        const result: ChatCompletionMessageParam[] = []
        for (const message of messages) {
            if (message.role === ChatRole.Tool) {
                if (message.tool_call_id) {
                    result.push({ role: ChatRole.Tool, tool_call_id: message.tool_call_id, content: message.content })
                }
            } else {
                result.push(message)
            }
        }
        return result
    }

}
