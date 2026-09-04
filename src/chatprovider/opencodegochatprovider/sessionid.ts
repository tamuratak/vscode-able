import * as vscode from 'vscode'
import type { LanguageModelChatRequestMessage } from 'vscode'

/**
 * The opencode go gateway requires a stable per-conversation id on every
 * outbound inference request via the x-opencode-session header. The id is
 * derived deterministically from the model id and the leading messages of
 * the request, so the provider stays stateless and nothing is persisted in
 * the chat transcript. The leading messages are typically the system
 * prompt, the user context, and the user request (or the system prompt and
 * the user request alone), which is enough to identify a conversation for
 * this purpose. An id collision is harmless because the gateway only uses
 * the id as a cache key (e.g. sticky provider selection), never to address
 * a specific conversation. The id is formatted like a UUID (8-4-4-4-12)
 * purely for readability.
 */

/** Number of leading messages hashed into the session id; later messages do not influence it. */
const SESSION_ID_PREFIX_MESSAGE_COUNT = 3

export const OPENCODE_SESSION_ID_HEADER = 'x-opencode-session'

/**
 * Derive a stable session id from the model id and the leading messages of
 * the request. Pass the messages before any tool-dependent rewriting so the
 * id does not change with the tool set.
 * @param modelId The id of the model serving the conversation.
 * @param messages The leading messages of the request.
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
        content: message.content.map(serializePart).filter(part => part !== undefined),
    }
}

function serializePart(part: unknown): unknown {
    // Only text parts are hashed; tool calls, tool results, and data parts
    // (e.g. attachments) are dropped because their representation in the
    // transcript is not stable when a conversation is resumed (e.g. file
    // attachments attached to the initial request).
    if (part instanceof vscode.LanguageModelTextPart) {
        return ['text', part.value]
    }
    return undefined
}
