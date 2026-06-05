/* eslint-disable @typescript-eslint/naming-convention */

import { EndpointApiType } from './models.js';

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
    /** API type (for internal use) */
    apiType: EndpointApiType;
    /** Custom HTTP headers */
    headers?: Record<string, string>;
}
