import * as vscode from 'vscode'
import { tokenizerManager } from './tokenizer/tokenizerManager.js'
import { getImageDimensions } from './tokenizer/imageUtils.js'
import { createDataUrl } from './vscodeutils.js'
import { logger } from './logger.js'

export const BaseTokensPerMessage = 3;
export const BaseTokensPerName = 1;

export async function countMessageTokens(
    text: string | { content: readonly unknown[] },
    modelConfig: { includeReasoningInRequest: boolean } = { includeReasoningInRequest: true }
): Promise<number> {
    if (typeof text === 'string') {
        return textTokenLength(text);
    } else {
        let totalTokens = BaseTokensPerMessage + BaseTokensPerName;

        for (const part of text.content) {
            if (part instanceof vscode.LanguageModelTextPart) {
                totalTokens += await textTokenLength(part.value);
            } else if (part instanceof vscode.LanguageModelDataPart) {
                if (part.mimeType.startsWith('image/')) {
                    totalTokens += calculateImageTokenCost(createDataUrl(part));
                } else if (part.mimeType === 'cache_control') {
                    /* ignore */
                } else {
                    totalTokens += calculateNonImageBinaryTokens(part.data.byteLength);
                }
            } else if (part instanceof vscode.LanguageModelToolCallPart) {
                totalTokens += BaseTokensPerName;
                totalTokens += await textTokenLength(JSON.stringify(part.input));
            } else if (part instanceof vscode.LanguageModelToolResultPart) {
                totalTokens += await textTokenLength(JSON.stringify(part.content));
            } else if (part instanceof vscode.LanguageModelThinkingPart) {
                if (modelConfig.includeReasoningInRequest) {
                    const thinkingText = Array.isArray(part.value) ? part.value.join('') : part.value;
                    totalTokens += await textTokenLength(thinkingText);
                }
            } else {
                const partType = part === null ? 'null' : typeof part === 'object' ? (part.constructor?.name ?? 'object') : typeof part;
                let partSample: string
                try {
                    partSample = JSON.stringify(part) ?? ''
                } catch {
                    partSample = String(part)
                }
                logger.warn('token.count.unknown_part', { partType, partSample: partSample.slice(0, 200) });
            }
        }
        return totalTokens;
    }
}

export async function textTokenLength(text: string): Promise<number> {
    try {
        return await tokenizerManager.countTokens(text);
    } catch {
        return 0;
    }
}

/**
 * Calculate token cost for an image based on its dimensions.
 */
export function calculateImageTokenCost(dataUrl: string): number {
    try {
        const { width, height } = getImageDimensions(dataUrl);

        // Default: 170 tokens per 512px tile
        const tileSize = 512;
        const tilesX = Math.ceil(width / tileSize);
        const tilesY = Math.ceil(height / tileSize);
        const totalTiles = tilesX * tilesY;

        // Base cost: 85 tokens, plus 170 per tile
        return 85 + 170 * totalTiles;
    } catch {
        // Fallback: estimate based on base64 length
        const base64Length = dataUrl.length;
        return Math.ceil(base64Length / 100);
    }
}

/**
 * Calculate token cost for non-image binary data.
 */
export function calculateNonImageBinaryTokens(byteLength: number): number {
    // Rough estimate: ~0.75 tokens per byte for binary data
    return Math.ceil(byteLength * 0.75);
}
