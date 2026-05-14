/* eslint-disable @typescript-eslint/naming-convention */
/**
 * A single model entry for OpenCode Go.
 */
export interface OpenCodeGoModelItem {
    id: string;
    context_length: number;
    vision: boolean;
    max_completion_tokens: number;
    reasoning_effort: string | undefined;
    enable_thinking: boolean;
    thinking_budget?: number;
    temperature?: number;
    top_p?: number;
    top_k?: number;
    min_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    repetition_penalty?: number;
    reasoning?: {
        effort?: string;
        exclude?: boolean;
        max_tokens?: number;
        enabled?: boolean;
    };
    extra?: Record<string, unknown>;
    /**
     * Whether to include reasoning_content in assistant messages sent to the API.
     */
    include_reasoning_in_request?: boolean;
    /**
     * Model-specific delay in milliseconds between consecutive requests.
     */
    delay: number;
    /** API mode (for internal use) */
    apiMode: 'openai' | 'anthropic';
    /** Whether this model supports switching thinking on/off ("switchable") or always has it ("always") */
    thinkingMode: 'switchable' | 'always';
    /** Custom HTTP headers */
    headers?: Record<string, string>;
}

/**
 * Retry configuration.
 */
export interface RetryConfig {
    enabled: boolean;
    maxAttempts: number;
    intervalMs: number;
    backoffFactor: number;
    maxIntervalMs: number;
    statusCodes: number[];
}
