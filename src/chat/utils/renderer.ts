import * as vscode from 'vscode'
import { LanguageModelChatMessage, LanguageModelChatMessageRole, LanguageModelTextPart, LanguageModelToolCallPart } from 'vscode'
import { renderToolResultPart } from '../../utils/toolresultrendering.js'


export async function renderMessages(
    messages: (LanguageModelChatMessage | vscode.LanguageModelChatMessage2)[]
): Promise<string> {
    const result: string[] = []

    for (const message of messages) {
        const roleHeader = getRoleHeader(message.role)
        result.push(roleHeader)

        for (const part of message.content) {
            if (part instanceof LanguageModelTextPart) {
                result.push(part.value)
            } else if (part instanceof LanguageModelToolCallPart) {
                result.push(`**Tool Call: ${part.name}**`)
                result.push('```json')
                result.push(JSON.stringify(part.input, null, 2))
                result.push('```')
            } else if ((part instanceof vscode.LanguageModelToolResultPart2) || (part instanceof vscode.LanguageModelToolResultPart)) {
                result.push(`**Tool Result (${part.callId}):**`)
                result.push('```')
                result.push(await renderToolResultPart(part))
                result.push('```')
            } else {
                // Skip LanguageModelDataPart or LanguageModelThinkingPart
                result.push('*[Data or Thinking part - not rendered]*')
            }
        }

        result.push('') // Add empty line between messages
    }

    return result.join('\n')
}

function getRoleHeader(role: LanguageModelChatMessageRole): string {
    switch (role) {
        case LanguageModelChatMessageRole.System:
            return '## System'
        case LanguageModelChatMessageRole.User:
            return '## User'
        case LanguageModelChatMessageRole.Assistant:
            return '## Assistant'
        default:
            return '## Unknown Role'
    }
}
