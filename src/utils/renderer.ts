import { LanguageModelChatMessageRole, LanguageModelDataPart, LanguageModelDataPart2, LanguageModelTextPart, LanguageModelTextPart2, LanguageModelThinkingPart, LanguageModelToolCallPart, LanguageModelToolResultPart, LanguageModelToolResultPart2 } from 'vscode'
import { renderToolResultPart } from './toolresultrendering.js'

interface ChatMessage {
    readonly role: LanguageModelChatMessageRole
    readonly content: readonly unknown[]
}

export async function renderMessages(
    messages: readonly ChatMessage[]
): Promise<string> {
    const result: string[] = []

    for (const message of messages) {
        result.push('\n\n')
        const roleHeader = getRoleHeader(message.role)
        result.push('\n')
        result.push(roleHeader)
        result.push('\n')
        const content = await renderMessageContent(message)
        result.push(...content)
    }
    return result.join('')
}

export async function renderMessageContent(
    message: Pick<ChatMessage, 'content'>
) {
    const result: string[] = []

    for (const part of message.content) {
        if (part instanceof LanguageModelTextPart || part instanceof LanguageModelTextPart2) {
            result.push(part.value)
        } else if (part instanceof LanguageModelToolCallPart) {
            result.push('\n')
            result.push(`**Tool Call: ${part.name} (${part.callId})**`)
            result.push('\n')
            result.push('```json')
            result.push('\n')
            result.push(JSON.stringify(part.input, null, 2))
            result.push('\n')
            result.push('```')
            result.push('\n')
        } else if (part instanceof LanguageModelToolResultPart || part instanceof LanguageModelToolResultPart2) {
            result.push('\n')
            result.push(`**Tool Result (${part.callId}):**`)
            result.push('\n')
            result.push('```')
            result.push('\n')
            result.push(await renderToolResultPart(part))
            result.push('\n')
            result.push('```')
            result.push('\n')
        } else if (part instanceof LanguageModelThinkingPart) {
            if (typeof part.value === 'string') {
                result.push(part.value)
            } else if (Array.isArray(part.value)) {
                result.push(part.value.join(''))
            }
        } else if (part instanceof LanguageModelDataPart || part instanceof LanguageModelDataPart2) {
            if (part.mimeType.startsWith('image/')) {
                result.push('\n')
                result.push('**Data Part:**')
                result.push('\n')
                result.push('mime: ' + part.mimeType)
                result.push('\n')
            }
        }
    }

    return result
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
