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
 * Generate a new session id and persist it in the transcript by reporting a
 * standalone assistant text part. The part survives in the chat messages and
 * is recovered by extractSessionId on the next request.
 * @param progress Progress reporter for response parts.
 * @returns The generated session id.
 */
export function emitSessionIdPart(progress: Progress<LanguageModelResponsePart2>): string {
    const sessionId = crypto.randomUUID()
    progress.report(new vscode.LanguageModelTextPart2(
        `\n<!-- ABLE_OPENCODE_SESSION_ID: ${sessionId} -->\n`,
        [vscode.LanguageModelPartAudience.Assistant]
    ))
    return sessionId
}

/**
 * Remove the session id parts from the messages so they are never sent to
 * the model; the id travels in the x-opencode-session header instead.
 * Messages whose content becomes empty after stripping are dropped.
 * @param messages The VS Code chat messages of the request.
 * @returns Messages without session id parts.
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
        const content = message.content.filter(
            part => !(part instanceof vscode.LanguageModelTextPart && SESSION_ID_TAG_PATTERN.test(part.value))
        )
        if (content.length === message.content.length) {
            stripped.push(message)
        } else if (content.length > 0) {
            stripped.push({ role: message.role, content, name: message.name })
        }
    }
    return stripped
}
