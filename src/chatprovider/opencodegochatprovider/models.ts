import type { LanguageModelChatInformation } from 'vscode'
import type { OpenCodeGoModelItem } from './types.js'


/**
 * Built-in model definition for OpenCode Go.
 */
interface BuiltInModelDef {
    baseId: string;
    displayName: string;
    vision: boolean;
    defaultReasoningEffort?: string;
    supportsReasoningEffort?: string[];
    maxInputTokens: number;
    maxOutputTokens: number;
    extra?: Record<string, unknown>;
    apiType?: EndpointApiType;
    delay?: number;
}

export type EndpointApiType = 'chat-completions' | 'responses' | 'messages';

/**
 * Built-in model definitions.
 * ? https://models.dev/api.json
 */
const BUILT_IN_MODELS: BuiltInModelDef[] = [
    // https://docs.z.ai/api-reference/llm/chat-completion
    { baseId: 'glm-5.1', displayName: 'GLM-5.1', vision: false, maxInputTokens: 200000, maxOutputTokens: 32768 },
    { baseId: 'glm-5', displayName: 'GLM-5', vision: false, maxInputTokens: 200000, maxOutputTokens: 32768 },

    // https://platform.kimi.ai/docs/api/chat#content-field-description
    { baseId: 'kimi-k2.5', displayName: 'Kimi K2.5', vision: true, maxInputTokens: 262144, maxOutputTokens: 32768 },
    { baseId: 'kimi-k2.6', displayName: 'Kimi K2.6', vision: true, maxInputTokens: 262144, maxOutputTokens: 32768 },

    // https://api-docs.deepseek.com/api/create-chat-completion
    { baseId: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', vision: false, defaultReasoningEffort: 'max', supportsReasoningEffort: ['high', 'max'], maxInputTokens: 1000000, maxOutputTokens: 32768 },
    { baseId: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', vision: false, defaultReasoningEffort: 'max', supportsReasoningEffort: ['high', 'max'], maxInputTokens: 1000000, maxOutputTokens: 32768 },

    // https://platform.xiaomimimo.com/docs/en-US/api/chat/openai-api
    { baseId: 'mimo-v2-pro', displayName: 'MiMo-V2-Pro', vision: false, maxInputTokens: 1000000, maxOutputTokens: 131072 },
    { baseId: 'mimo-v2-omni', displayName: 'MiMo-V2-Omni', vision: true, maxInputTokens: 1000000, maxOutputTokens: 32768 },
    { baseId: 'mimo-v2.5-pro', displayName: 'MiMo-V2.5-Pro', vision: false, maxInputTokens: 1000000, maxOutputTokens: 131072 },
    { baseId: 'mimo-v2.5', displayName: 'MiMo-V2.5', vision: false, maxInputTokens: 1000000, maxOutputTokens: 32768 },

    // https://platform.minimax.io/docs/api-reference/text-anthropic-api
    { baseId: 'minimax-m2.7', displayName: 'MiniMax M2.7', vision: false, apiType: 'messages', maxInputTokens: 197000, maxOutputTokens: 32768 },
    { baseId: 'minimax-m2.5', displayName: 'MiniMax M2.5', vision: false, apiType: 'messages', maxInputTokens: 197000, maxOutputTokens: 32768 },

    // https://docs.qwencloud.com/api-reference/chat/anthropic
    // https://www.qwencloud.com/models/qwen3.7-max
    // https://www.qwencloud.com/models/qwen3.6-plus
    // https://www.qwencloud.com/models/qwen3.5-plus
    { baseId: 'qwen3.7-max', displayName: 'Qwen3.7 Max', vision: true, apiType: 'messages', maxInputTokens: 1000000, maxOutputTokens: 32768 },
    { baseId: 'qwen3.6-plus', displayName: 'Qwen3.6 Plus', vision: true, apiType: 'messages', maxInputTokens: 1000000, maxOutputTokens: 32768 },
    { baseId: 'qwen3.5-plus', displayName: 'Qwen3.5 Plus', vision: true, apiType: 'messages', maxInputTokens: 1000000, maxOutputTokens: 32768 },

    // https://huggingface.co/tencent/Hy3-preview
    { baseId: 'hy3-preview', displayName: 'Hy3 preview', vision: false, defaultReasoningEffort: 'high', supportsReasoningEffort: ['low', 'high'], maxInputTokens: 262144, maxOutputTokens: 32768 }
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
                imageInput: def.vision,
                // Use replace_string_in_file tool only.
                // https://github.com/microsoft/vscode/blob/4b04bed81a929b4603b508ce4a21993ae5fee2af/extensions/copilot/package.json#L770
                editTools: ['find-replace']
            },
            isUserSelectable: true
        };

        // Build enum values based on thinking mode
        const hasEfforts = def.supportsReasoningEffort && def.supportsReasoningEffort.length > 0;
        let enumValues: string[];
        if (hasEfforts) {
            enumValues = ['disabled', ...def.supportsReasoningEffort!];
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
        vision: def.vision,
        context_length: def.maxInputTokens,
        max_completion_tokens: def.maxOutputTokens,
        apiType: def.apiType ?? 'chat-completions',
        reasoning_effort: undefined,
        enable_thinking: true,
        include_reasoning_in_request: true,
        delay: def.delay ?? 0
    };

    // Set default reasoning effort if configured
    if (def.defaultReasoningEffort) {
        model.reasoning_effort = def.defaultReasoningEffort;
    }

    // Pass through extra body parameters
    if (def.extra) {
        model.extra = { ...def.extra };
    }

    return model;
}
