import * as vscode from 'vscode'
import type { LanguageModelChatRequestMessage } from 'vscode'

/**
 * The opencode go gateway requires a stable per-conversation id on every
 * outbound inference request via the x-opencode-session header. The id is
 * derived deterministically from the model id and the leading messages of
 * the request, so the provider stays stateless and nothing is persisted in
 * the chat transcript. The id is formatted like a UUID (8-4-4-4-12) purely
 * for readability.
 */

/** Number of leading messages hashed into the session id; later messages do not influence it. */
const SESSION_ID_PREFIX_MESSAGE_COUNT = 3

export const OPENCODE_SESSION_ID_HEADER = 'x-opencode-session'

/**
 * Derive a stable session id from the model id and the leading messages of
 * the request.
 * @param modelId The id of the model serving the conversation.
 * @param messages The outbound messages of the request.
 * @returns A UUID-shaped session id derived from a SHA-256 fingerprint.
 */
export async function deriveSessionId(modelId: string, messages: readonly LanguageModelChatRequestMessage[]): Promise<string> {
    const fingerprint = JSON.stringify({
        modelId,
        messages: messages.slice(0, SESSION_ID_PREFIX_MESSAGE_COUNT).map(serializeMessage),
    })
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint))
    const bytes = new Uint8Array(digest)
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

function serializeMessage(message: LanguageModelChatRequestMessage): unknown {
    return {
        role: message.role,
        name: message.name,
        content: message.content.map(serializePart),
    }
}

function serializePart(part: unknown): unknown {
    // Parts are tagged by type so that different part kinds never hash to
    // the same fingerprint.
    if (part instanceof vscode.LanguageModelTextPart) {
        return ['text', part.value]
    }
    if (part instanceof vscode.LanguageModelToolCallPart) {
        return ['toolCall', part.callId, part.name, part.input]
    }
    if (part instanceof vscode.LanguageModelToolResultPart) {
        return ['toolResult', part.callId, part.content.map(p => serializePart(p))]
    }
    if (part instanceof vscode.LanguageModelDataPart) {
        return ['data', part.mimeType]
    }
    // Unknown part types (e.g. prompt-tsx parts) are tagged only; their
    // payloads are not stable enough to hash.
    return ['unknown']
}
