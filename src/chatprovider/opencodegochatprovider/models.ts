import type { LanguageModelChatInformation } from 'vscode';
import type { OpenCodeGoModelItem } from './types.js';


/**
 * Built-in model definition for OpenCode Go.
 */
interface BuiltInModelDef {
    /** Base model ID sent to the API (e.g., "glm-5.1") */
    baseId: string;
    /** User-friendly display name (e.g., "GLM-5.1") */
    displayName: string;
    /** Whether the model supports image input */
    vision: boolean;
    /** Thinking mode: "switchable" = two variants registered, "always" = thinking forced on */
    thinkingMode: 'switchable' | 'always';
    /** Default reasoning effort when thinking is enabled */
    defaultReasoningEffort?: string;
    /** Supported reasoning effort levels for the model picker UI */
    supportedReasoningEfforts?: string[];
    /** Whether to include reasoning_content in assistant messages */
    includeReasoningInRequest?: boolean;
    /** Default context length */
    contextLength?: number;
    /** Default max output tokens */
    maxTokens?: number;
    /** Extra body parameters to include in API requests */
    extra?: Record<string, unknown>;
    /** API mode: "openai" (default) or "anthropic" */
    apiMode?: 'openai' | 'anthropic';
}

const EXTENSION_LABEL = 'OpenCodeGo';
const DEFAULT_CONTEXT_LENGTH = 128000;
const DEFAULT_MAX_TOKENS = 4096;

/**
 * Built-in model definitions.
 */
const BUILT_IN_MODELS: BuiltInModelDef[] = [
    { baseId: 'glm-5.1', displayName: 'GLM-5.1', vision: false, thinkingMode: 'always', contextLength: 200000, maxTokens: 131072 },
    { baseId: 'glm-5', displayName: 'GLM-5', vision: false, thinkingMode: 'always', contextLength: 200000, maxTokens: 131072 },

    { baseId: 'kimi-k2.5', displayName: 'Kimi K2.5', vision: true, thinkingMode: 'always', contextLength: 262144, maxTokens: 16384 },
    { baseId: 'kimi-k2.6', displayName: 'Kimi K2.6', vision: true, thinkingMode: 'always', contextLength: 262144, maxTokens: 16384 },

    { baseId: 'deepseek-v4-pro', displayName: 'DeepSeek V4 Pro', vision: false, thinkingMode: 'switchable', defaultReasoningEffort: 'max', supportedReasoningEfforts: ['high', 'max'], contextLength: 1000000, maxTokens: 393216 },
    { baseId: 'deepseek-v4-flash', displayName: 'DeepSeek V4 Flash', vision: false, thinkingMode: 'switchable', defaultReasoningEffort: 'max', supportedReasoningEfforts: ['high', 'max'], contextLength: 1000000, maxTokens: 393216 },

    { baseId: 'mimo-v2-pro', displayName: 'MiMo-V2-Pro', vision: false, thinkingMode: 'always', contextLength: 262144, maxTokens: 32768 },
    { baseId: 'mimo-v2-omni', displayName: 'MiMo-V2-Omni', vision: true, thinkingMode: 'always', contextLength: 262144, maxTokens: 32768 },
    { baseId: 'mimo-v2.5-pro', displayName: 'MiMo-V2.5-Pro', vision: false, thinkingMode: 'always', contextLength: 262144, maxTokens: 32768 },
    { baseId: 'mimo-v2.5', displayName: 'MiMo-V2.5', vision: false, thinkingMode: 'always', contextLength: 262144, maxTokens: 32768 },

    { baseId: 'minimax-m2.7', displayName: 'MiniMax M2.7', vision: false, thinkingMode: 'always', apiMode: 'anthropic', extra: { reasoning_split: true }, contextLength: 204800, maxTokens: 32768 },
    { baseId: 'minimax-m2.5', displayName: 'MiniMax M2.5', vision: false, thinkingMode: 'always', contextLength: 204800, maxTokens: 32768 },

    { baseId: 'qwen3.6-plus', displayName: 'Qwen3.6 Plus', vision: true, thinkingMode: 'switchable', contextLength: 1000000, maxTokens: 32768 },
    { baseId: 'qwen3.5-plus', displayName: 'Qwen3.5 Plus', vision: true, thinkingMode: 'switchable', contextLength: 1000000, maxTokens: 32768 },
];

/**
 * Get the built-in model list as LanguageModelChatInformation[].
 * Each model registers one entry with a configurationSchema for reasoning effort selection.
 * - switchable models: include "禁用思考" option so user can turn off thinking
 * - always models: no "禁用思考" option, thinking always on
 * All labels and descriptions use l10n() for i18n.
 */
export function getBuiltInModelInfos(): LanguageModelChatInformation[] {
    const infos: LanguageModelChatInformation[] = [];

    for (const def of BUILT_IN_MODELS) {
        const info: LanguageModelChatInformation = {
            id: def.baseId,
            name: def.displayName,
            detail: 'OpenCode Go',
            tooltip: 'OpenCode Go',
            family: EXTENSION_LABEL,
            version: '1.0.0',
            maxInputTokens: def.contextLength ?? DEFAULT_CONTEXT_LENGTH,
            maxOutputTokens: def.maxTokens ?? DEFAULT_MAX_TOKENS,
            capabilities: {
                toolCalling: true,
                imageInput: def.vision,
            },
            isUserSelectable: true
        };

        // Build enum values based on thinking mode
        const hasEfforts = def.supportedReasoningEfforts && def.supportedReasoningEfforts.length > 0;
        let enumValues: string[];
        if (hasEfforts) {
            if (def.thinkingMode === 'switchable') {
                enumValues = ['disabled', ...def.supportedReasoningEfforts!];
            } else {
                enumValues = [...def.supportedReasoningEfforts!];
            }
        } else {
            if (def.thinkingMode === 'switchable') {
                enumValues = ['disabled', 'enabled'];
            } else {
                enumValues = ['enabled'];
            }
        }

        // Map effort values to localized labels and descriptions
        // Keys are English strings that serve as fallback for non-Chinese locales
        const getLabel = (e: string): string => {
            switch (e) {
                case 'disabled': return 'Disabled';
                case 'enabled': return 'Thinking';
                case 'low': return 'Low';
                case 'medium': return 'Medium';
                case 'high': return 'High';
                case 'max': return 'Maximum';
                default: return e.charAt(0).toUpperCase() + e.slice(1);
            }
        };
        const getDesc = (e: string): string => {
            switch (e) {
                case 'disabled': return 'Do not enable thinking';
                case 'enabled': return 'Enable thinking';
                case 'low': return 'Reduce thinking, faster response';
                case 'medium': return 'Balance thinking and speed';
                case 'high': return 'Deeper thinking, slower response';
                case 'max': return 'Maximum thinking depth, slowest response';
                default: return e;
            }
        };

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

/**
 * Get the total count of built-in model entries (after expanding switchable models).
 */
export function getBuiltInModelCount(): number {
    return BUILT_IN_MODELS.length;
}

/**
 * Find a built-in model definition by model ID.
 * Returns the model properties including thinking mode, API mode, and extra parameters.
 * Thinking state (enable_thinking) is initially set to true and will be adjusted
 * by provider.ts based on the user's reasoning effort selection.
 */
export function getBuiltInModelConfig(modelId: string): OpenCodeGoModelItem | undefined {
    const def = BUILT_IN_MODELS.find((m) => m.baseId === modelId);
    if (!def) {
        return undefined;
    }

    const model: OpenCodeGoModelItem = {
        id: def.baseId,
        owned_by: 'opencode',
        displayName: def.displayName,
        vision: def.vision,
        context_length: def.contextLength ?? DEFAULT_CONTEXT_LENGTH,
        max_completion_tokens: def.maxTokens ?? DEFAULT_MAX_TOKENS,
        apiMode: def.apiMode ?? 'openai',
        enable_thinking: true,
        include_reasoning_in_request: true,
        thinkingMode: def.thinkingMode,
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
