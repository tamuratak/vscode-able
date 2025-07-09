import * as vscode from 'vscode'
import type { HistoryEntry } from '../prompt.js'
import { AbleChatParticipantId } from '../../main.js'
import { isAbleChatResultMetadata } from './chatresultmetadata.js'


export function extractAbleCommandHistory(context: vscode.ChatContext): HistoryEntry[] {
    const history: HistoryEntry[] = []
    for (const hist of context.history) {
        if (hist.participant !== AbleChatParticipantId) {
            continue
        }
        if (hist.command === 'fluent' || hist.command === 'fluent_ja' || hist.command === 'to_en' || hist.command === 'to_ja') {
            if (hist instanceof vscode.ChatResponseTurn) {
                const chatResultMetadata = hist.result.metadata
                if (chatResultMetadata && isAbleChatResultMetadata(chatResultMetadata)) {
                    history.push({
                        type: 'user',
                        command: hist.command,
                        text: chatResultMetadata.input,
                    })
                    history.push({
                        type: 'assistant',
                        text: chatResultMetadata.output,
                    })
                }
            }
        }
    }
    return history
}

export function extractHitory(context: vscode.ChatContext): HistoryEntry[] {
    const history: HistoryEntry[] = []
    for (const hist of context.history) {
        if (hist.participant === AbleChatParticipantId) {
            if (hist.command === 'fluent' || hist.command === 'fluent_ja' || hist.command === 'to_en' || hist.command === 'to_ja') {
                continue
            }
        }
        if (hist instanceof vscode.ChatRequestTurn) {
            history.push({ type: 'user', text: hist.prompt })
        } else if (hist instanceof vscode.ChatResponseTurn) {
            history.push({ type: 'assistant', text: chatResponseToString(hist) })
        } else {
            hist satisfies never
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
