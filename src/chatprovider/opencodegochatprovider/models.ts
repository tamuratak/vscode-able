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
    apiType?: EndpointApiType;
    inputModalities?: InputType[] | undefined;
    defaultReasoningEffort?: string;
    supportsReasoningEffort?: string[];
    maxInputTokens: number;
    maxOutputTokens: number;
    // https://github.com/microsoft/vscode/blob/4b04bed81a929b4603b508ce4a21993ae5fee2af/extensions/copilot/package.json#L770
    // 'apply-patch', 'find-replace', 'multi-find-replace'
    editTools?: string[];
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
        readonly cacheWriteCost?: number;
        readonly longContextInputCost?: number;
        readonly longContextOutputCost?: number;
        readonly longContextCacheCost?: number;
        readonly longContextCacheWriteCost?: number;
        readonly priceCategory?: string;
    }
}

export type EndpointApiType = 'chat-completions' | 'responses' | 'messages';

/**
 * Built-in model definitions.
 * ? https://models.dev/api.json
 */
const BUILT_IN_MODELS: BuiltInModelDef[] = [
    // https://developers.openai.com/api/docs/models/gpt-5.6-luna
    // https://developers.openai.com/api/reference/resources/responses/methods/create
    { baseId: 'gpt-5.6-luna', displayName: 'GPT-5.6 Luna', apiType: 'responses', inputModalities: ['image'], defaultReasoningEffort: 'max', supportsReasoningEffort: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], maxInputTokens: 1000000, maxOutputTokens: 100000, editTools: ['apply-patch'], pricing: { inputCost: 0.2, outputCost: 1.2, cacheCost: 0.02, cacheWriteCost: 0.25, longContextInputCost: 0.4, longContextOutputCost: 1.8, longContextCacheCost: 0.04, longContextCacheWriteCost: 0.50 } },

    // https://docs.x.ai/developers/model-capabilities/text/reasoning
    { baseId: 'grok-4.5', displayName: 'Grok-4.5', apiType: 'responses', inputModalities: ['image', 'video'], defaultReasoningEffort: 'high', supportsReasoningEffort: ['low', 'medium', 'high'], maxInputTokens: 200000, maxOutputTokens: 32768, pricing: { inputCost: 4, outputCost: 12, cacheCost: 1 } },

    // https://docs.z.ai/api-reference/llm/chat-completion
    { baseId: 'glm-5.3-flash', displayName: 'GLM-5.3 Flash', inputModalities: ['image'], defaultReasoningEffort: 'high', supportsReasoningEffort: ['low', 'high', 'max'], maxInputTokens: 1000000, maxOutputTokens: 32768, pricing: { inputCost: 0.075, outputCost: 0.25, cacheCost: 0.015 } },
    { baseId: 'glm-5.3', displayName: 'GLM-5.3', defaultReasoningEffort: 'max', supportsReasoningEffort: ['high', 'max'], maxInputTokens: 1000000, maxOutputTokens: 62768, pricing: { inputCost: 1.4, outputCost: 4.4, cacheCost: 0.26 } },
    { baseId: 'glm-5.2', displayName: 'GLM-5.2', defaultReasoningEffort: 'max', supportsReasoningEffort: ['high', 'max'], maxInputTokens: 1000000, maxOutputTokens: 62768, pricing: { inputCost: 1.4, outputCost: 4.4, cacheCost: 0.26 } },

    // https://platform.kimi.ai/docs/api/chat#content-field-description
    // https://docs.fireworks.ai/api-reference/post-chatcompletions
    { baseId: 'kimi-k3', displayName: 'Kimi K3', inputModalities: ['image', 'video'], maxInputTokens: 1000000, maxOutputTokens: 32768, pricing: { inputCost: 3, outputCost: 15, cacheCost: 0.3 } },
    { baseId: 'kimi-k2.7-code', displayName: 'Kimi K2.7 Code', inputModalities: ['image', 'video'], maxInputTokens: 262144, maxOutputTokens: 32768, pricing: { inputCost: 0.95, outputCost: 4, cacheCost: 0.19 } },

    // https://api-docs.deepseek.com/api/create-chat-completion
    { baseId: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', defaultReasoningEffort: 'max', supportsReasoningEffort: ['low', 'high', 'max'], maxInputTokens: 1000000, maxOutputTokens: 32768, pricing: { inputCost: 0.66, outputCost: 1.98, cacheCost: 0.022 } },
    { baseId: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', defaultReasoningEffort: 'max', supportsReasoningEffort: ['low', 'high', 'max'], maxInputTokens: 1000000, maxOutputTokens: 32768, pricing: { inputCost: 0.22, outputCost: 0.66, cacheCost: 0.007 } },
    { baseId: 'deepseek-v4-flash-vision-exp', displayName: 'DeepSeek V4 Flash Vision Exp', inputModalities: ['image'], defaultReasoningEffort: 'max', supportsReasoningEffort: ['low', 'high', 'max'], maxInputTokens: 1000000, maxOutputTokens: 32768, pricing: { inputCost: 0.22, outputCost: 0.66, cacheCost: 0.007 } },

    // https://platform.xiaomimimo.com/docs/en-US/api/chat/openai-api
    { baseId: 'mimo-v2.5-pro', displayName: 'MiMo-V2.5-Pro', maxInputTokens: 1000000, maxOutputTokens: 65536, extra: { frequency_penalty: 0.01 }, pricing: { inputCost: 1.74, outputCost: 3.48, cacheCost: 0.0145 } },
    { baseId: 'mimo-v2.5', displayName: 'MiMo-V2.5', inputModalities: ['image', 'audio', 'video'], maxInputTokens: 1000000, maxOutputTokens: 32768, extra: { frequency_penalty: 0.01 }, pricing: { inputCost: 0.14, outputCost: 0.28, cacheCost: 0.0028 } },

    // https://platform.minimax.io/docs/api-reference/text-anthropic-api
    { baseId: 'minimax-m3', displayName: 'MiniMax M3', inputModalities: ['image', 'video'], apiType: 'messages', maxInputTokens: 1000000, maxOutputTokens: 32768, extra: { thinking: { type: 'adaptive' } }, pricing: { inputCost: 0.3, outputCost: 1.2, cacheCost: 0.06 } },

    // https://docs.qwencloud.com/api-reference/chat/anthropic
    // https://www.qwencloud.com/models/qwen3.8-flash
    // https://www.qwencloud.com/models/qwen3.7-max
    // https://www.qwencloud.com/models/qwen3.7-plus
    { baseId: 'qwen3.8-flash', displayName: 'Qwen3.8 Flash', inputModalities: ['image', 'video'], maxInputTokens: 1000000, maxOutputTokens: 16384, extra: { thinking: { type: 'enabled', budget_tokens: 32768 } }, pricing: { inputCost: 0.15, outputCost: 0.47, cacheCost: 0.016, cacheWriteCost: 0.2 } },
    { baseId: 'qwen3.7-max', displayName: 'Qwen3.7 Max', apiType: 'messages', maxInputTokens: 1000000, maxOutputTokens: 16384, extra: { thinking: { type: 'enabled', budget_tokens: 32768 } }, pricing: { inputCost: 2.5, outputCost: 7.5, cacheCost: 0.5 } },
    { baseId: 'qwen3.7-plus', displayName: 'Qwen3.7 Plus', inputModalities: ['image', 'video'], apiType: 'messages', maxInputTokens: 1000000, maxOutputTokens: 16384, extra: { thinking: { type: 'enabled', budget_tokens: 32768 } }, pricing: { inputCost: 0.4, outputCost: 1.6, cacheCost: 0.04, longContextInputCost: 1.2, longContextOutputCost: 4.8, longContextCacheCost: 0.12 } },

    // https://dev.meta.ai/docs/models
    // https://dev.meta.ai/docs/protocols/responses
    { baseId: 'muse-spark-1.2-contributor', displayName: 'Muse Spark 1.2 Contributor', inputModalities: ['image', 'video', 'pdf'], apiType: 'responses', defaultReasoningEffort: 'xhigh', supportsReasoningEffort: ['minimal', 'low', 'medium', 'high', 'xhigh'], maxInputTokens: 1000000, maxOutputTokens: 32768, pricing: { inputCost: 0.1, outputCost: 0.2, cacheCost: 0.02 } },

]

export function getBuiltInModelInfos(): LanguageModelChatInformation[] {
    const infos: LanguageModelChatInformation[] = [];

    for (const def of BUILT_IN_MODELS) {
        const info: LanguageModelChatInformation = {
            id: def.baseId,
            name: def.displayName,
            category: 'powerful',
            detail: 'OpenCode Go',
            isBYOK: true,
            tooltip: 'OpenCode Go',
            family: def.baseId,
            version: '1.0.0',
            maxInputTokens: def.maxInputTokens - def.maxOutputTokens,
            maxOutputTokens: def.maxOutputTokens,
            capabilities: {
                toolCalling: true,
                imageInput: def.inputModalities?.includes('image') ?? false,
                // Default edit tools when the model definition does not specify any.
                // https://github.com/microsoft/vscode/blob/4b04bed81a929b4603b508ce4a21993ae5fee2af/extensions/copilot/package.json#L770
                editTools: def.editTools ?? ['find-replace', 'multi-find-replace']
            },
            isUserSelectable: true,
            ...def.pricing
        };

        // Build enum values based on thinking mode
        const hasEfforts = def.supportsReasoningEffort && def.supportsReasoningEffort.length > 0;
        let enumValues: string[];
        if (hasEfforts) {
            enumValues = [...def.supportsReasoningEffort!];
        } else if (def.apiType === 'messages') {
            enumValues = ['enabled']
        } else {
            enumValues = ['enabled'];
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
        case 'xhigh': return 'Extra High';
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
