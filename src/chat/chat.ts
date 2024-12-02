import * as vscode from 'vscode'
import { FluentPrompt, MAKE_FLUENT_PROMPT } from './prompt'
import { renderPrompt } from '@vscode/prompt-tsx'

function makeFluentPrompt(input: string) {
    return MAKE_FLUENT_PROMPT + '\n' + input
}

export interface HistoryEntry {
    type: 'user' | 'assistant'
    text: string
}

export type AbleHistory = HistoryEntry[]

export const handler: vscode.ChatRequestHandler = async (
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
) => {
    const ableHistory = extractAbleHistory(context)
    if (request.command === 'fluent') {
        let prompt = ''
        let selectedText = ''
        for (const ref of request.references) {
            if (ref.id === 'vscode.implicit.selection') {
                const { uri, range } = ref.value as { uri: vscode.Uri, range: vscode.Range }
                const doc = await vscode.workspace.openTextDocument(uri)
                selectedText = doc.getText(range)
                prompt = makeFluentPrompt(selectedText)
                break
            }
        }
        const {messages} = await renderPrompt(FluentPrompt, {history: ableHistory, prompt}, { modelMaxPromptTokens: 4096 }, request.model)
        const chatResponse = await request.model.sendRequest(messages, {}, token)

        let responseText = ''
        for await (const fragment of chatResponse.text) {
            responseText += fragment
        }
        stream.markdown('#### input\n' + selectedText + '\n\n')
        stream.markdown('#### output\n' + responseText)
        return
    } else {
        const {messages} = await renderPrompt(FluentPrompt, {history: ableHistory, prompt: request.prompt}, { modelMaxPromptTokens: 4096 }, request.model)
        const chatResponse = await request.model.sendRequest(messages, {}, token)
        for await (const fragment of chatResponse.text) {
            stream.markdown(fragment)
        }
    }
}

function extractAbleHistory(context: vscode.ChatContext): HistoryEntry[] {
    const history: HistoryEntry[] = []
    for (const hist of context.history) {
        if (hist.command === 'fluent') {
            if (hist instanceof vscode.ChatResponseTurn) {
                const response = chatResponseToString(hist)
                const pair = extractInputAndOutput(response)
                if (pair) {
                    const user = makeFluentPrompt(pair.input)
                    const assistant = pair.output
                    history.push({type: 'user', text: user})
                    history.push({type: 'assistant', text: assistant})
                }
            }
        } else if (hist.participant === 'able.chatParticipant') {
            if (hist instanceof vscode.ChatRequestTurn) {
                history.push({type: 'user', text: hist.prompt})
            } else if (hist instanceof vscode.ChatResponseTurn) {
                history.push({type: 'assistant', text: chatResponseToString(hist)})
            }
        }
    }
    return history
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
    const regex = /#### input\n(.+?)\n\n#### output\n(.+)/s;
    const match = str.match(regex);
    if (match) {
        const input = match[1];
        const output = match[2];
        return {input, output}
    } else {
        return
    }
}
