import * as vscode from 'vscode'
import type { HistoryEntry } from '../prompt.js'
import { vscodeImplicitSelectionId } from './referenceutils.js'


export function convertHistory(context: vscode.ChatContext): HistoryEntry[] {
    const history: HistoryEntry[] = []
    for (const hist of context.history) {
        if (hist.participant === 'able.chatParticipant') {
            if (hist.command === 'fluent' || hist.command === 'fluent_ja' || hist.command === 'to_en' || hist.command === 'to_ja') {
                if (hist instanceof vscode.ChatRequestTurn) {
                    if (!hist.references.find((ref) => ref.id === vscodeImplicitSelectionId)) {
                        history.push({ type: 'user', command: hist.command, text: hist.prompt })
                    }
                } else {
                    const response = chatResponseToString(hist)
                    const pair = extractInputAndOutput(response)
                    if (pair) {
                        history.push({ type: 'user', command: hist.command, text: pair.input })
                        history.push({ type: 'assistant', text: pair.output })
                    } else {
                        history.push({ type: 'assistant', command: hist.command, text: response })
                    }
                }
                continue
            }
        }
        if (hist instanceof vscode.ChatRequestTurn) {
            history.push({ type: 'user', text: hist.prompt })
        } else if (hist instanceof vscode.ChatResponseTurn) {
            history.push({ type: 'assistant', text: chatResponseToString(hist) })
        }
    }
    return history
}

// copy from https://github.com/microsoft/vscode-chat-extension-utils/blob/96aa0cf30acda27bd6e77749703097137a43c047/src/components/history.tsx#L113
function chatResponseToString(response: vscode.ChatResponseTurn): string {
    let str = ''
    for (const part of response.response) {
        if (part instanceof vscode.ChatResponseMarkdownPart) {
            str += part.value.value
        } else if (part instanceof vscode.ChatResponseAnchorPart) {
            if (part.title) {
                str += `[${part.title}](`
            }
            const uri = part.value instanceof vscode.Uri ? part.value : part.value.uri
            if (uri.scheme === 'file') {
                str += uri.fsPath
            } else {
                str += uri.toString()
            }
            if (part.title) {
                str += ')'
            }
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
