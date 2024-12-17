import * as vscode from 'vscode'
import { FluentJaPrompt, FluentPrompt, HistoryEntry, InputProps, SimplePrompt, ToEnPrompt, ToJaPrompt } from './prompt.js'
import { ChatMessage, ChatRole, PromptElementCtor, renderPrompt } from '@vscode/prompt-tsx'
import { ExternalPromise } from '../utils/externalpromise.js'
import { OpenAI } from 'openai'
import { Gpt4oTokenizer } from './tokenizer.js'
import type { ChatCompletionMessageParam } from 'openai/resources/index'


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
            this.gpt4omini.resolve(mini)
        } else {
            const message = 'Failed to load GPT-4o Mini model'
            this.gpt4omini.reject(new Error(message))
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
                const chatResponse = await this.openAiGpt4oMiniResponse(token, request.prompt, SimplePrompt, ableHistory)
                stream.markdown(chatResponse.choices[0]?.message.content ?? '')
            }
        }
    }

    private async responseWithSelection<S>(
        token: vscode.CancellationToken,
        request: vscode.ChatRequest,
        ctor: PromptElementCtor<InputProps, S>,
        ableHistory: HistoryEntry[],
        model?: vscode.LanguageModelChat
    ) {
        const selectedText = await getSelectedText(request)
        const input = selectedText ?? request.prompt
        let responseText = ''
        if (this.vendor === ChatVendor.Copilot) {
            const chatResponse = await this.copilotChatResponse(token, input, ctor, ableHistory, model)
            for await (const fragment of chatResponse.text) {
                responseText += fragment
            }
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
        input: string,
        ctor: PromptElementCtor<InputProps, S>,
        ableHistory: HistoryEntry[],
        model?: vscode.LanguageModelChat
    ) {
        if (!model) {
            model = await this.gpt4omini.promise
        }
        const { messages } = await renderPrompt(ctor, { history: ableHistory, input }, { modelMaxPromptTokens: 1024 }, model)
        const chatResponse = await model.sendRequest(messages, {}, token)
        return chatResponse
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

function extractAbleHistory(context: vscode.ChatContext): HistoryEntry[] {
    const history: HistoryEntry[] = []
    for (const hist of context.history) {
        if (hist.participant === 'able.chatParticipant') {
            if (hist.command === 'fluent' || hist.command === 'fluent_ja' || hist.command === 'to_en' || hist.command === 'to_ja') {
                if (hist instanceof vscode.ChatRequestTurn) {
                    if (!hist.references.find((ref) => ref.id === 'vscode.implicit.selection')) {
                        history.push({ type: 'user', command: hist.command, text: hist.prompt })
                    }
                } else if (hist instanceof vscode.ChatResponseTurn) {
                    const response = chatResponseToString(hist)
                    const pair = extractInputAndOutput(response)
                    if (pair) {
                        history.push({ type: 'user', command: hist.command, text: pair.input })
                        history.push({ type: 'assistant', text: pair.output })
                    } else {
                        history.push({ type: 'assistant', command: hist.command, text: response })
                    }
                }
            } else {
                if (hist instanceof vscode.ChatRequestTurn) {
                    history.push({ type: 'user', text: hist.prompt })
                } else if (hist instanceof vscode.ChatResponseTurn) {
                    history.push({ type: 'assistant', text: chatResponseToString(hist) })
                }
            }
        }
    }
    return history
}

async function getSelectedText(request: vscode.ChatRequest) {
    for (const ref of request.references) {
        if (ref.id === 'vscode.implicit.selection') {
            const { uri, range } = ref.value as { uri: vscode.Uri, range: vscode.Range }
            const doc = await vscode.workspace.openTextDocument(uri)
            return doc.getText(range)
        }
    }
    return
}

function chatResponseToString(response: vscode.ChatResponseTurn): string {
    let str = ''
    for (const part of response.response) {
        if (part instanceof vscode.ChatResponseMarkdownPart) {
            str += part.value.value
        }
    }
    return str
}

function extractInputAndOutput(str: string) {
    const regex = /#### input\n(.+?)\n\n#### output\n(.+)/s
    const match = str.match(regex)
    if (match) {
        const input = match[1]
        const output = match[2]
        return { input, output }
    } else {
        return
    }
}

