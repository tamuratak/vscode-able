/* eslint-disable @typescript-eslint/naming-convention */
import type { LanguageModelChatInformation } from 'vscode'
import type { OpenCodeGoModelItem } from './types.js'


type InputType = 'text' | 'image' | 'audio' | 'video' | 'pdf'

/**
 * Built-in model definition for OpenCode Go.
 */
interface BuiltInModelDef {
    baseId: string;
    displayName: string;
    inputModalities?: InputType[] | undefined;
    defaultReasoningEffort?: string;
    supportsReasoningEffort?: string[];
    maxInputTokens: number;
    maxOutputTokens: number;
    apiType?: EndpointApiType;
    /**
     * Additional request body fields that are merged into the API request body.
     * Because these fields are assigned after all other body parameters,
     * they can override any existing request body field (e.g. frequency_penalty, thinking, etc.).
     */
    extra?: {
        frequency_penalty?: number,
        thinking?: {
            // Anthropic messages API-compat thinking configuration
            // https://docs.qwencloud.com/api-reference/chat/anthropic#thinking
            // https://platform.minimax.io/docs/api-reference/text-chat-anthropic#body-thinking
            type: 'enabled' | 'disabled' | 'adaptive',
            budget_tokens?: number
        } | {
            // Kimi API reasoning configuration
            // https://platform.kimi.ai/docs/api/chat#body-one-of-0-thinking
            type: 'enabled' | 'disabled',
            keep: 'all' | null
        }
    };
    pricing?: {
        readonly pricing?: string;
        readonly inputCost?: number;
        readonly outputCost?: number;
        readonly cacheCost?: number;
        readonly longContextInputCost?: number;
        readonly longContextOutputCost?: number;
        readonly longContextCacheCost?: number;
        readonly priceCategory?: string;
    }
}

export type EndpointApiType = 'chat-completions' | 'responses' | 'messages';

/**
 * Built-in model definitions.
 * ? https://models.dev/api.json
 */
const BUILT_IN_MODELS: BuiltInModelDef[] = [
    // https://docs.z.ai/api-reference/llm/chat-completion
    { baseId: 'glm-5.2', displayName: 'GLM-5.2', defaultReasoningEffort: 'max', supportsReasoningEffort: ['high', 'max'], maxInputTokens: 1000000, maxOutputTokens: 62768, pricing: { inputCost: 1.4, outputCost: 4.4, cacheCost: 0.26 } },
    { baseId: 'glm-5.1', displayName: 'GLM-5.1', maxInputTokens: 200000, maxOutputTokens: 32768, pricing: { inputCost: 1.4, outputCost: 4.4, cacheCost: 0.26 } },

    // https://platform.kimi.ai/docs/api/chat#content-field-description
    // https://docs.fireworks.ai/api-reference/post-chatcompletions
    { baseId: 'kimi-k2.7-code', displayName: 'Kimi K2.7 Code', inputModalities: ['image', 'video'], maxInputTokens: 262144, maxOutputTokens: 32768, pricing: { inputCost: 0.95, outputCost: 4, cacheCost: 0.19 } },
    { baseId: 'kimi-k2.6', displayName: 'Kimi K2.6', inputModalities: ['image', 'video'], maxInputTokens: 262144, maxOutputTokens: 32768, extra: { thinking: { type: 'enabled', keep: 'all' } }, pricing: { inputCost: 0.95, outputCost: 4, cacheCost: 0.16 } },

    // https://api-docs.deepseek.com/api/create-chat-completion
    { baseId: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', defaultReasoningEffort: 'max', supportsReasoningEffort: ['high', 'max'], maxInputTokens: 1000000, maxOutputTokens: 32768, pricing: { inputCost: 1.74, outputCost: 3.48, cacheCost: 0.0145 } },
    { baseId: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', defaultReasoningEffort: 'max', supportsReasoningEffort: ['high', 'max'], maxInputTokens: 1000000, maxOutputTokens: 32768, pricing: { inputCost: 0.14, outputCost: 0.28, cacheCost: 0.0028 } },

    // https://platform.xiaomimimo.com/docs/en-US/api/chat/openai-api
    { baseId: 'mimo-v2.5-pro', displayName: 'MiMo-V2.5-Pro', maxInputTokens: 1000000, maxOutputTokens: 65536, extra: { frequency_penalty: 0.01 }, pricing: { inputCost: 1.74, outputCost: 3.48, cacheCost: 0.0145 } },
    { baseId: 'mimo-v2.5', displayName: 'MiMo-V2.5', inputModalities: ['image', 'audio', 'video'], maxInputTokens: 1000000, maxOutputTokens: 32768, extra: { frequency_penalty: 0.01 }, pricing: { inputCost: 0.14, outputCost: 0.28, cacheCost: 0.0028 } },

    // https://platform.minimax.io/docs/api-reference/text-anthropic-api
    { baseId: 'minimax-m3', displayName: 'MiniMax M3', inputModalities: ['image', 'video'], apiType: 'messages', maxInputTokens: 1000000, maxOutputTokens: 32768, extra: { thinking: { type: 'adaptive' } }, pricing: { inputCost: 0.3, outputCost: 1.2, cacheCost: 0.06 } },
    { baseId: 'minimax-m2.7', displayName: 'MiniMax M2.7', apiType: 'messages', maxInputTokens: 197000, maxOutputTokens: 32768, pricing: { inputCost: 0.3, outputCost: 1.2, cacheCost: 0.06 } },

    // https://docs.qwencloud.com/api-reference/chat/anthropic
    // https://www.qwencloud.com/models/qwen3.7-max
    // https://www.qwencloud.com/models/qwen3.7-plus
    // https://www.qwencloud.com/models/qwen3.6-plus
    { baseId: 'qwen3.7-max', displayName: 'Qwen3.7 Max', apiType: 'messages', maxInputTokens: 1000000, maxOutputTokens: 16384, extra: { thinking: { type: 'enabled', budget_tokens: 32768 } }, pricing: { inputCost: 2.5, outputCost: 7.5, cacheCost: 0.5 } },
    { baseId: 'qwen3.7-plus', displayName: 'Qwen3.7 Plus', inputModalities: ['image', 'video'], apiType: 'messages', maxInputTokens: 1000000, maxOutputTokens: 16384, extra: { thinking: { type: 'enabled', budget_tokens: 32768 } }, pricing: { inputCost: 0.4, outputCost: 1.6, cacheCost: 0.04, longContextInputCost: 1.2, longContextOutputCost: 4.8, longContextCacheCost: 0.12 } },
    { baseId: 'qwen3.6-plus', displayName: 'Qwen3.6 Plus', inputModalities: ['image', 'video'], apiType: 'messages', maxInputTokens: 1000000, maxOutputTokens: 16384, extra: { thinking: { type: 'enabled', budget_tokens: 32768 } }, pricing: { inputCost: 0.5, outputCost: 3, cacheCost: 0.05, longContextInputCost: 2, longContextOutputCost: 6, longContextCacheCost: 0.2 } }
]

export function getBuiltInModelInfos(): LanguageModelChatInformation[] {
    const infos: LanguageModelChatInformation[] = [];

    for (const def of BUILT_IN_MODELS) {
        const info: LanguageModelChatInformation = {
            id: def.baseId,
            name: def.displayName,
            detail: 'OpenCode Go',
            tooltip: 'OpenCode Go',
            family: def.baseId,
            version: '1.0.0',
            maxInputTokens: def.maxInputTokens - def.maxOutputTokens,
            maxOutputTokens: def.maxOutputTokens,
            capabilities: {
                toolCalling: true,
                imageInput: def.inputModalities?.includes('image') ?? false,
                // Use replace_string_in_file tool only.
                // https://github.com/microsoft/vscode/blob/4b04bed81a929b4603b508ce4a21993ae5fee2af/extensions/copilot/package.json#L770
                editTools: ['find-replace']
            },
            isUserSelectable: true,
            ...def.pricing
        };

        // Build enum values based on thinking mode
        const hasEfforts = def.supportsReasoningEffort && def.supportsReasoningEffort.length > 0;
        let enumValues: string[];
        if (hasEfforts) {
            enumValues = ['disabled', ...def.supportsReasoningEffort!];
        } else if (def.apiType === 'messages') {
            enumValues = ['enabled']
        } else {
            enumValues = ['disabled', 'enabled'];
        }

        const enumItemLabels = enumValues.map(getLabel);
        const enumDescriptions = enumValues.map(getDesc);

        // Determine default: for switchable with efforts, use defaultReasoningEffort or last item;
        // for others, use the last enum value (enabled/highest effort)
        const defaultEffort = (hasEfforts && def.defaultReasoningEffort)
            ? def.defaultReasoningEffort
            : enumValues[enumValues.length - 1];

        infos.push({
            ...info,
            configurationSchema: {
                properties: {
                    reasoningEffort: {
                        type: 'string',
                        title: 'Reasoning Effort',
                        enum: enumValues,
                        enumItemLabels,
                        enumDescriptions,
                        default: defaultEffort,
                        group: 'navigation',
                    },
                },
            },
        } satisfies LanguageModelChatInformation);
    }

    return infos;
}

function getLabel(e: string): string {
    switch (e) {
        case 'disabled': return 'Disabled';
        case 'enabled': return 'Thinking';
        case 'low': return 'Low';
        case 'medium': return 'Medium';
        case 'high': return 'High';
        case 'max': return 'Maximum';
        default: return e.charAt(0).toUpperCase() + e.slice(1);
    }
}

function getDesc(e: string): string {
    switch (e) {
        case 'disabled': return 'Do not enable thinking';
        case 'enabled': return 'Enable thinking';
        case 'low': return 'Reduce thinking, faster response';
        case 'medium': return 'Balance thinking and speed';
        case 'high': return 'Deeper thinking, slower response';
        case 'max': return 'Maximum thinking depth, slowest response';
        default: return e;
    }
}

export function getBuiltInModelCount(): number {
    return BUILT_IN_MODELS.length;
}

export function getBuiltInModelConfig(modelId: string): OpenCodeGoModelItem | undefined {
    const def = BUILT_IN_MODELS.find((m) => m.baseId === modelId);
    if (!def) {
        return undefined;
    }

    const model: OpenCodeGoModelItem = {
        id: def.baseId,
        vision: def.inputModalities?.includes('image') ?? false,
        context_length: def.maxInputTokens,
        max_completion_tokens: def.maxOutputTokens,
        apiType: def.apiType ?? 'chat-completions',
        enable_thinking: true,
        include_reasoning_in_request: true
    };

    // Set default reasoning effort if configured
    if (def.defaultReasoningEffort) {
        model.reasoning_effort = def.defaultReasoningEffort;
    }

    // Pass through extra body parameters
    if (def.extra) {
        model.extra = structuredClone(def.extra);
    }

    return model;
}
