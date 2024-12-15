import * as vscode from 'vscode'
import { FluentJaPrompt, FluentPrompt, HistoryEntry, SimplePrompt, ToEnPrompt, ToJaPrompt } from './prompt.js'
import { PromptElementCtor, renderPrompt } from '@vscode/prompt-tsx'
import { ExternalPromise } from '../utils/externalpromise.js'
//import { Tokenizer } from './tokenizer.js'


export type RequestCommands = 'fluent' | 'fluent_ja' | 'to_en' | 'to_ja'

export class ChatHandler {
    //    private readonly tokenizer = new Tokenizer()
    private readonly gpt4omini = new ExternalPromise<vscode.LanguageModelChat>()

    constructor(public readonly openAiServiceId: string) { }

    async initGpt4oMini() {
        const [mini,] = await vscode.lm.selectChatModels({
            vendor: 'copilot',
            family: 'gpt-4o-mini'
        })
        if (!mini) {
            console.error('Failed to load GPT-4o Mini model')
        }
        this.gpt4omini.resolve(mini)
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
                const response = await this.copilotChatResponseWithSelection(request, token, FluentPrompt, ableHistory)
                stream.markdown(response)
                return
            } else if (request.command === 'fluent_ja') {
                const response = await this.copilotChatResponseWithSelection(request, token, FluentJaPrompt, ableHistory)
                stream.markdown(response)
                return
            } if (request.command === 'to_en') {
                const response = await this.copilotChatResponseWithSelection(request, token, ToEnPrompt, ableHistory)
                stream.markdown(response)
                return
            } else if (request.command === 'to_ja') {
                const response = await this.copilotChatResponseWithSelection(request, token, ToJaPrompt, ableHistory)
                stream.markdown(response)
                return
            } {
                const chatResponse = await this.copilotChatResponse(token, SimplePrompt, ableHistory, request.prompt, request.model)
                for await (const fragment of chatResponse.text) {
                    stream.markdown(fragment)
                }
            }
        }
    }

    private async copilotChatResponseWithSelection(
        request: vscode.ChatRequest,
        token: vscode.CancellationToken,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctor: PromptElementCtor<any, any>,
        ableHistory: HistoryEntry[],
        model?: vscode.LanguageModelChat
    ) {
        const selectedText = await getSelectedText(request)
        const input = selectedText ?? request.prompt
        const chatResponse = await this.copilotChatResponse(token, ctor, ableHistory, input, model)

        let responseText = ''
        for await (const fragment of chatResponse.text) {
            responseText += fragment
        }
        if (selectedText) {
            return '#### input\n' + input + '\n\n' + '#### output\n' + responseText
        } else {
            return responseText
        }
    }

    private async copilotChatResponse(
        token: vscode.CancellationToken,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctor: PromptElementCtor<any, any>,
        ableHistory: HistoryEntry[],
        input: string,
        model?: vscode.LanguageModelChat
    ) {
        if (!model) {
            model = await this.gpt4omini.promise
        }
        const { messages } = await renderPrompt(ctor, { history: ableHistory, input }, { modelMaxPromptTokens: 1024 }, model)
        const chatResponse = await model.sendRequest(messages, {}, token)
        return chatResponse
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

