/* eslint-disable @typescript-eslint/naming-convention */
/**
MIT License


Copyright (c) 2025 Johnny Zhao, also under the MIT License. (https://github.com/JohnnyZ93/oai-compatible-copilot)

Copyright (c) 2025 Hugging Face https://github.com/huggingface/huggingface-vscode-chat

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
import type { APIUsage } from '../../commonApi.js'

/** Extract the text of a Responses API summary content part, or '' when absent. */
export function summaryTextOf(part: unknown): string {
	if (typeof part !== 'object' || part === null || Array.isArray(part)) {
		return ''
	}
	if (!('text' in part)) {
		return ''
	}
	return typeof part['text'] === 'string' ? part['text'] : ''
}

/** Extract the refusal text of a chat-completions style delta object, or '' when absent. */
export function refusalTextOf(delta: unknown): string {
	if (typeof delta !== 'object' || delta === null || Array.isArray(delta)) {
		return ''
	}
	if (!('refusal' in delta)) {
		return ''
	}
	return typeof delta['refusal'] === 'string' ? delta['refusal'] : ''
}

/** Coerce a text payload that may be a plain string or an object with a text-ish field. */
export function coerceText(value: unknown): string {
	if (typeof value === 'string') {
		return value
	}
	if (value && typeof value === 'object') {
		const obj = value as Record<string, unknown>
		if (typeof obj['text'] === 'string') {
			return obj['text']
		}
		if (typeof obj['thinking'] === 'string') {
			return obj['thinking']
		}
		if (typeof obj['reasoning'] === 'string') {
			return obj['reasoning']
		}
		if (typeof obj['summary'] === 'string') {
			return obj['summary']
		}
		if (typeof obj['value'] === 'string') {
			return obj['value']
		}
	}
	return ''
}

/** Whether a chunk is a reasoning configuration value rather than reasoning text. */
export function looksLikeReasoningConfigValue(value: string): boolean {
	const v = (value || '').trim().toLowerCase()
	return (
		v === 'high' ||
		v === 'medium' ||
		v === 'low' ||
		v === 'minimal' ||
		v === 'auto' ||
		v === 'none' ||
		v === 'detailed' ||
		v === 'concise'
	)
}

/** Extract the combined output_text of a completed message item, or '' when absent. */
export function extractOutputText(item: Record<string, unknown>): string {
	const content = item['content']
	if (!Array.isArray(content)) {
		return ''
	}
	let text = ''
	for (const part of content) {
		if (!part || typeof part !== 'object' || Array.isArray(part)) {
			continue
		}
		const record = part as Record<string, unknown>
		if (record['type'] === 'output_text' && typeof record['text'] === 'string') {
			text += record['text']
		}
	}
	return text
}

/** Extract the tool call id of an event or output item, or '' when absent. */
export function getCallIdFromEvent(event: Record<string, unknown>): string {
	// The arguments delta/done events carry only item_id (the output item
	// id, fc_*), never the tool call id (call_*); falling back to item_id
	// would emit a mismatched id that breaks the next turn's tool results.
	// The call id is obtained from the output_item events instead.
	const callIdRaw = event['call_id'] ?? event['callId']
	return typeof callIdRaw === 'string' ? callIdRaw : ''
}

/** Synthesize a finish reason from a completed event, using the flushed tool call state as a fallback. */
export function synthesizeFinishReason(event: Record<string, unknown>, completedToolCallIndices: Set<number>): string | undefined {
	const response =
		event['response'] && typeof event['response'] === 'object' && !Array.isArray(event['response'])
			? (event['response'] as Record<string, unknown>)
			: undefined
	if (!response) {
		// Some gateways emit a flat completion event without a nested response object.
		// Fall back to the tool call flush state so a tool-call response is
		// not misclassified as stop.
		return event['status'] === 'completed'
			? completedToolCallIndices.size > 0
				? 'tool_calls'
				: 'stop'
			: undefined
	}

	// If the final output contains function calls, the model requested tools.
	const output = response['output']
	if (Array.isArray(output)) {
		for (const item of output) {
			if (item && typeof item === 'object' && !Array.isArray(item)) {
				const record = item as Record<string, unknown>
				if (record['type'] === 'function_call') {
					return 'tool_calls'
				}
			}
		}
	}

	if (response['status'] === 'completed') {
		// Gateways may omit the output array; fall back to the tool call
		// flush state so a tool-call response is not misclassified as stop.
		return completedToolCallIndices.size > 0 ? 'tool_calls' : 'stop'
	}
	return undefined
}

/** Map the incomplete details of a response.incomplete event to a finish reason. */
export function synthesizeIncompleteFinishReason(details: unknown): string {
	const reason = details && typeof details === 'object'
		? (details as Record<string, unknown>)['reason']
		: undefined
	return reason === 'content_filter' ? 'content_filter' : 'length'
}

/**
 * Extract usage from a completed/incomplete event, mapping the Responses token
 * breakdown to the chat-completions style shape, or undefined when absent.
 */
export function extractUsage(event: Record<string, unknown>): APIUsage | undefined {
	const usage = event['usage'] ?? (event['response'] as Record<string, unknown> | undefined)?.['usage']
	if (!usage || typeof usage !== 'object') {
		return undefined
	}
	const u = usage as Record<string, unknown>
	const inputDetails = u['input_tokens_details']
	const details: { cached_tokens: number; cache_creation_input_tokens?: number } = {
		cached_tokens: 0,
	}
	if (inputDetails && typeof inputDetails === 'object') {
		const inputDetailsObj = inputDetails as Record<string, unknown>
		details.cached_tokens = Number(inputDetailsObj['cached_tokens'] ?? 0)
		const cacheWriteTokens = Number(inputDetailsObj['cache_write_tokens'] ?? 0)
		if (cacheWriteTokens > 0) {
			details.cache_creation_input_tokens = cacheWriteTokens
		}
	}
	// Map the Responses output token breakdown to the chat-completions style
	// completion_tokens_details so reasoning tokens are visible to clients.
	const outputDetails = u['output_tokens_details']
	const completionDetails: { reasoning_tokens: number } | undefined =
		outputDetails && typeof outputDetails === 'object'
			? { reasoning_tokens: Number((outputDetails as Record<string, unknown>)['reasoning_tokens'] ?? 0) }
			: undefined
	return {
		prompt_tokens: Number(u['input_tokens'] ?? 0),
		completion_tokens: Number(u['output_tokens'] ?? 0),
		total_tokens: Number(u['total_tokens'] ?? 0),
		prompt_tokens_details: details,
		completion_tokens_details: completionDetails,
	}
}
