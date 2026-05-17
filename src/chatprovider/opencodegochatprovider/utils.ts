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
