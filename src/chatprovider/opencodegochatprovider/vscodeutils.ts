/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode'
import { OpenAIFunctionToolDef } from './openai/openaiTypes.js'

/**
 * Map VS Code message role to OpenAI message role string.
 */
export function mapRole(message: vscode.LanguageModelChatRequestMessage): 'user' | 'assistant' | 'system' {
    const role = message.role
    if (role === vscode.LanguageModelChatMessageRole.User) {
        return 'user';
    } else if (role === vscode.LanguageModelChatMessageRole.Assistant) {
        return 'assistant';
    } else {
        return 'system';
    }
}

/**
 * Convert VS Code tool definitions to OpenAI function tool definitions.
 */
export function convertToolsToOpenAI(
    options?: vscode.ProvideLanguageModelChatResponseOptions
): { tools?: OpenAIFunctionToolDef[]; tool_choice?: string | undefined } {
    if (!options?.tools || options.tools.length === 0) {
        return {};
    }

    const tools: OpenAIFunctionToolDef[] = options.tools.map((tool) => {
        const def: OpenAIFunctionToolDef = {
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description,
            },
        };
        // Use the tool's inputSchema as parameters if available
        if (tool.inputSchema) {
            def.function.parameters = tool.inputSchema;
        } else {
            def.function.parameters = { type: 'object', properties: {} };
        }
        return def;
    });

    // Determine tool_choice mode
    const toolMode = (options?.modelOptions as Record<string, unknown> | undefined)?.['toolMode'] as string | undefined;

    let toolChoice: 'required' | 'none' | 'auto' = 'auto'
    if (toolMode === 'required') {
        toolChoice = 'required';
    } else if (toolMode === 'none') {
        toolChoice = 'none';
    } else if (toolMode === 'auto') {
        toolChoice = 'auto';
    }

    return { tools, tool_choice: toolChoice };
}

/**
 * Check if a mime type is an image type.
 */
export function isImageMimeType(mimeType: string): boolean {
    return mimeType.startsWith('image/');
}

/**
 * Create a data URL from a LanguageModelDataPart.
 */
export function createDataUrl(part: vscode.LanguageModelDataPart): string {
    const base64 = arrayBufferToBase64(part.data);
    return `data:${part.mimeType};base64,${base64}`;
}

function arrayBufferToBase64(buffer: Uint8Array): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

/**
 * Check if a part is a tool result part.
 */
export function isToolResultPart(
    part: unknown
): part is vscode.LanguageModelToolResultPart {
    return part instanceof vscode.LanguageModelToolResultPart;
}

/**
 * Collect text content from a tool result part.
 */
export function collectToolResultText(part: {
    content?: readonly unknown[];
}): string {
    if (!part.content) {
        return '';
    }
    const texts: string[] = [];
    for (const item of part.content) {
        if (item instanceof vscode.LanguageModelTextPart) {
            texts.push(item.value);
        }
    }
    return texts.join('\n').trim();
}

/**
 * Collect image data parts from a tool result part.
 */
export function collectToolResultImages(part: {
    content?: readonly unknown[];
}): vscode.LanguageModelDataPart[] {
    if (!part.content) {
        return [];
    }
    const images: vscode.LanguageModelDataPart[] = [];
    for (const item of part.content) {
        if (item instanceof vscode.LanguageModelDataPart && isImageMimeType(item.mimeType)) {
            images.push(item);
        }
    }
    return images;
}

/**
 * Serialize a value to a JSON string with sorted keys for stable comparison.
 */
function sortedStringify(value: unknown): string {
    if (value === null || value === undefined || typeof value !== 'object') {
        return JSON.stringify(value)
    }
    if (Array.isArray(value)) {
        return '[' + value.map(sortedStringify).join(',') + ']'
    }
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    const pairs = keys.map(k => JSON.stringify(k) + ':' + sortedStringify(obj[k]))
    return '{' + pairs.join(',') + '}'
}

/**
 * Information about a detected tool call loop.
 */
export interface ToolLoopInfo {
    detected: boolean
    callName: string
    callInput: Record<string, unknown>
    repeatCount: number
}

/**
 * Check if the tail of the messages contains a loop of identical tool calls.
 *
 * Scans backwards from the end of the message list looking for the pattern:
 *   ... assistant(toolCall) -> user(toolResult) -> assistant(toolCall) -> ...
 * where each assistant tool call has the same name and input.
 *
 * @param messages The conversation messages to inspect.
 * @param minRepeatCount Minimum consecutive repetitions to consider a loop (default: 3).
 */
export function isToolCallLoopDetected(
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    minRepeatCount = 3
): ToolLoopInfo {
    if (messages.length === 0 || minRepeatCount < 2) {
        return { detected: false, callName: '', callInput: {}, repeatCount: 0 }
    }

    // Collect tool calls from the last assistant message
    const lastAssistantIdx = findLastAssistantWithToolCall(messages, messages.length - 1)
    if (lastAssistantIdx < 0) {
        return { detected: false, callName: '', callInput: {}, repeatCount: 0 }
    }

    const lastToolCalls = extractToolCalls(messages[lastAssistantIdx])
    if (lastToolCalls.length === 0) {
        return { detected: false, callName: '', callInput: {}, repeatCount: 0 }
    }

    const signature = sortedStringify(lastToolCalls)
    const callName = lastToolCalls[0].name
    const callInput = lastToolCalls[0].input

    let repeatCount = 1
    let currentIdx = lastAssistantIdx

    for (;;) {
        // Expect a user (tool result) message before the previous assistant message
        const prevIdx = currentIdx - 1
        if (prevIdx < 0) {
            break
        }
        if (messages[prevIdx].role !== vscode.LanguageModelChatMessageRole.User) {
            break
        }

        // Expect an assistant message before the user message
        const prevAssistantIdx = findLastAssistantWithToolCall(messages, prevIdx - 1)
        if (prevAssistantIdx < 0) {
            break
        }

        const prevToolCalls = extractToolCalls(messages[prevAssistantIdx])
        if (sortedStringify(prevToolCalls) !== signature) {
            break
        }

        repeatCount += 1
        currentIdx = prevAssistantIdx
    }

    return {
        detected: repeatCount >= minRepeatCount,
        callName,
        callInput,
        repeatCount,
    }
}

function findLastAssistantWithToolCall(
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    fromIndex: number
): number {
    for (let i = fromIndex; i >= 0; i--) {
        const msg = messages[i]
        if (msg.role === vscode.LanguageModelChatMessageRole.Assistant) {
            for (const part of msg.content) {
                if (part instanceof vscode.LanguageModelToolCallPart) {
                    return i
                }
            }
        }
    }
    return -1
}

function extractToolCalls(
    message: vscode.LanguageModelChatRequestMessage
): { name: string; input: Record<string, unknown> }[] {
    const calls: { name: string; input: Record<string, unknown> }[] = []
    for (const part of message.content) {
        if (part instanceof vscode.LanguageModelToolCallPart) {
            calls.push({ name: part.name, input: part.input as Record<string, unknown> })
        }
    }
    return calls
}

/**
 * The target tool name for duplicate detection.
 */
const DEDUP_TOOL_NAME = 'replace_string_in_file'

/**
 * Extract tool call signatures from the last assistant message in the conversation.
 * Only considers tool calls whose name matches {@link DEDUP_TOOL_NAME}.
 *
 * @param messages The conversation messages to inspect.
 * @returns A set of sorted-stringified signatures for the matching tool calls.
 */
export function extractLastToolCallSignatures(
    messages: readonly vscode.LanguageModelChatRequestMessage[]
): Set<string> {
    const signatures = new Set<string>()
    const lastAssistant = messages.findLast(msg => msg.role === vscode.LanguageModelChatMessageRole.Assistant)
    if (!lastAssistant) {
        return signatures
    }
    for (const part of lastAssistant.content) {
        if (part instanceof vscode.LanguageModelToolCallPart && part.name === DEDUP_TOOL_NAME) {
            signatures.add(sortedStringify(part.input))
        }
    }
    return signatures
}

/**
 * Create a progress wrapper that filters out duplicate {@link DEDUP_TOOL_NAME} tool calls.
 *
 * Duplicate detection compares each incoming tool call's signature against
 * `previousSignatures` (from the conversation history) and any calls already
 * reported during the current response.
 *
 * When a duplicate is detected, the original tool call is suppressed and two
 * messages are reported instead: one for the user audience and one for the LLM audience.
 *
 * @param progress The underlying progress reporter to wrap.
 * @param previousSignatures Signatures of tool calls from the conversation history.
 *   This set is cloned internally and grown as new calls are reported.
 * @returns A new progress reporter with duplicate filtering applied.
 */
export function createDedupProgress(
    progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
    previousSignatures: Set<string>
): vscode.Progress<vscode.LanguageModelResponsePart2> {
    const reportedSignatures = new Set(previousSignatures)
    return {
        report(part: vscode.LanguageModelResponsePart2) {
            if (part instanceof vscode.LanguageModelToolCallPart && part.name === DEDUP_TOOL_NAME) {
                const sig = sortedStringify(part.input)
                if (reportedSignatures.has(sig)) {
                    progress.report(new vscode.LanguageModelTextPart2(
                        '[OpenCode Go] Skipped a duplicate file edit that was identical to the previous call. No change was needed.',
                        [vscode.LanguageModelPartAudience.User]
                    ))
                    progress.report(new vscode.LanguageModelTextPart2(
                        'This replace_string_in_file call was identical to the previous call with the same arguments and was skipped. The edit has already been applied. Try a different approach or ask the user for guidance.',
                        [vscode.LanguageModelPartAudience.Assistant]
                    ))
                    return
                }
                reportedSignatures.add(sig)
            }
            progress.report(part)
        }
    }
}

/**
 * Safely try to parse a JSON object from a string.
 * Returns { ok: true, value } or { ok: false }.
 */
export function tryParseJSONObject(
    text: string
): { ok: true; value: Record<string, unknown> } | { ok: false } {
    try {
        const parsed = JSON.parse(text) as unknown;
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            return { ok: true, value: parsed as Record<string, unknown> };
        }
        return { ok: false };
    } catch {
        return { ok: false };
    }
}
