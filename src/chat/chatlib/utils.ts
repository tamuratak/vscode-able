import * as vscode from 'vscode'
import { HistoryEntry } from '../prompt.js'
import { ChatMessage, ChatRole } from '@vscode/prompt-tsx'
import type { ChatCompletionMessageParam } from 'openai/resources/index'

export async function getSelectedText(request: vscode.ChatRequest) {
    for (const ref of request.references) {
        if (ref.id === 'vscode.implicit.selection') {
            const { uri, range } = ref.value as { uri: vscode.Uri, range: vscode.Range }
            const doc = await vscode.workspace.openTextDocument(uri)
            return doc.getText(range)
        }
    }
    return
}

export function extractAbleHistory(context: vscode.ChatContext): HistoryEntry[] {
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

export function convertToChatCompletionMessageParams(messages: ChatMessage[]): ChatCompletionMessageParam[] {
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

export function getLmTools() {
    const tools: vscode.LanguageModelChatTool[] = []
    const ablePython = vscode.lm.tools.find(tool => tool.name === 'able_python')
    if (ablePython && ablePython.inputSchema) {
        tools.push({ name: ablePython.name, description: ablePython.description, inputSchema: ablePython.inputSchema })
    }
    return tools
}
