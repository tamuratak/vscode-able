import * as vscode from 'vscode'
import { LanguageModelChatMessage, LanguageModelChatMessageRole, LanguageModelTextPart, LanguageModelToolCallPart, LanguageModelToolResultPart, LanguageModelToolResultPart2 } from 'vscode'
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
        if (part instanceof LanguageModelTextPart) {
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
        } else if ((part instanceof LanguageModelToolResultPart2) || (part instanceof LanguageModelToolResultPart)) {
            result.push('\n')
            result.push(`**Tool Result (${part.callId}):**`)
            result.push('\n')
            result.push('```')
            result.push('\n')
            result.push(await renderToolResultPart(part))
            result.push('\n')
            result.push('```')
            result.push('\n')
        } else if (part instanceof vscode.LanguageModelThinkingPart) {
            if (typeof part.value === 'string') {
                result.push(part.value)
            } else if (Array.isArray(part.value)) {
                result.push(part.value.join(''))
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

export async function renderMessageWithTag(message: LanguageModelChatMessage | vscode.LanguageModelChatMessage2) {
    let startTag: string
    let endTag: string

    switch (message.role) {
        case LanguageModelChatMessageRole.System: {
            startTag = '<system>'
            endTag = '</system>'
            break
        }
        case LanguageModelChatMessageRole.User: {
            startTag = '<user>'
            endTag = '</user>'
            break
        }
        case LanguageModelChatMessageRole.Assistant: {
            startTag = '<assistant>'
            endTag = '</assistant>'
            break
        }
        default: {
            startTag = '<unknown>'
            endTag = '</unknown>'
            break
        }
    }

    const contentParts: string[] = []
    for (const part of message.content) {
        if (part instanceof LanguageModelTextPart) {
            contentParts.push(part.value)
        } if (part instanceof LanguageModelToolCallPart) {
            contentParts.push(`<tool_call name="${part.name}" callId="${part.callId}">`)
            contentParts.push(JSON.stringify(part.input, null, 2))
            contentParts.push('</tool_call>')
        } if ((part instanceof vscode.LanguageModelToolResultPart2) || (part instanceof vscode.LanguageModelToolResultPart)) {
            contentParts.push(`<tool_result callId="${part.callId}">`)
            contentParts.push(await renderToolResultPart(part))
            contentParts.push('</tool_result>')
        } if (part instanceof vscode.LanguageModelThinkingPart) {
            const reasoning = Array.isArray(part.value) ? part.value.join('\n') : part.value
            if (reasoning) {
                contentParts.push('<thinking>')
                contentParts.push(reasoning)
                contentParts.push('</thinking>')
            }
        }
    }
    return `${startTag}\n${contentParts.join('\n')}\n${endTag}`
}
