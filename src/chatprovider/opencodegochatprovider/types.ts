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
    reasoning_effort?: string | undefined;
    enable_thinking: boolean;
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
