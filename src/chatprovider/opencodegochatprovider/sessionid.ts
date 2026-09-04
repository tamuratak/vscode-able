import * as vscode from 'vscode'
import type { LanguageModelChatRequestMessage, LanguageModelResponsePart2, Progress } from 'vscode'

/**
 * The opencode go gateway requires a stable per-conversation id on every
 * outbound inference request via the x-opencode-session header. The provider
 * itself must stay stateless, so the id is persisted inside the chat
 * messages: it is emitted once as a standalone assistant part tagged with
 * LanguageModelPartAudience.Assistant, recovered from the message history on
 * subsequent requests, stripped from the model payload, and sent as a header
 * instead.
 */

/** Marker embedded in a text part; the HTML comment is stripped from the chat view. */
const SESSION_ID_TAG_PATTERN = /<!--\s*ABLE_OPENCODE_SESSION_ID:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s*-->/

/** Global variant for removing every marker occurrence from a part value. */
const SESSION_ID_TAG_GLOBAL_PATTERN = new RegExp(SESSION_ID_TAG_PATTERN.source, 'g')

export const OPENCODE_SESSION_ID_HEADER = 'x-opencode-session'

/**
 * Extract the session id from the message history, most recent occurrence
 * first.
 * @param messages The VS Code chat messages of the request.
 * @returns The session id, or undefined when the history has none.
 */
export function extractSessionId(messages: readonly LanguageModelChatRequestMessage[]): string | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role !== vscode.LanguageModelChatMessageRole.Assistant) {
            continue
        }
        const content = messages[i].content
        for (let j = content.length - 1; j >= 0; j--) {
            const part = content[j]
            if (part instanceof vscode.LanguageModelTextPart) {
                const match = SESSION_ID_TAG_PATTERN.exec(part.value)
                if (match) {
                    return match[1]
                }
            }
        }
    }
    return undefined
}

/**
 * Persist a session id in the transcript by reporting a standalone
 * assistant text part. The part survives in the chat messages and is
 * recovered by extractSessionId on the next request.
 * Note: concurrent requests to the same conversation may each emit their
 * own marker; the transcript converges on the most recent id, so the
 * gateway may temporarily see two ids for one conversation during the
 * overlap.
 * @param sessionId The session id to persist in the transcript.
 * @param progress Progress reporter for response parts.
 */
export function emitSessionIdPart(sessionId: string, progress: Progress<LanguageModelResponsePart2>): void {
    progress.report(new vscode.LanguageModelTextPart2(
        `<!-- ABLE_OPENCODE_SESSION_ID: ${sessionId} -->`,
        [vscode.LanguageModelPartAudience.Assistant]
    ))
}

/**
 * Remove the session id marker text from the messages so it is never sent to
 * the model; the id travels in the x-opencode-session header instead. The
 * marker may share a text part with the response body (VS Code merges
 * adjacent text parts), so only the marker string is removed and the
 * remaining text is kept. A message is dropped entirely only when all of its
 * parts consisted solely of markers.
 * @param messages The VS Code chat messages of the request.
 * @returns Messages without session id markers.
 */
export function stripSessionIdParts(messages: readonly LanguageModelChatRequestMessage[]): LanguageModelChatRequestMessage[] {
    const stripped: LanguageModelChatRequestMessage[] = []
    for (const message of messages) {
        // The marker is only ever emitted into assistant messages; skipping
        // user messages keeps user content intact if it coincidentally
        // contains the marker text.
        if (message.role !== vscode.LanguageModelChatMessageRole.Assistant) {
            stripped.push(message)
            continue
        }
        const content: unknown[] = []
        let changed = false
        for (const part of message.content) {
            if (part instanceof vscode.LanguageModelTextPart) {
                const value = part.value.replace(SESSION_ID_TAG_GLOBAL_PATTERN, '')
                if (value !== part.value) {
                    changed = true
                    if (value.length > 0) {
                        // The audience tag is irrelevant for the outbound
                        // payload; the value is all that reaches the model.
                        content.push(new vscode.LanguageModelTextPart(value))
                    }
                    continue
                }
            }
            content.push(part)
        }
        if (!changed) {
            stripped.push(message)
        } else if (content.length > 0) {
            stripped.push({ role: message.role, content, name: message.name })
        }
    }
    return stripped
}
