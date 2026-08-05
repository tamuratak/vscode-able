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
import type { ProvideLanguageModelChatResponseOptions } from 'vscode'

import type { OpenCodeGoModelItem } from '../types.js'
import { convertToolsToOpenAI } from '../vscodeutils.js'

/**
 * Convert VS Code tool definitions to OpenAI Responses API tool definitions.
 * Responses uses `{ type: "function", name, description, parameters }` (no nested `function` object).
 */
export function convertToolsToOpenAIResponses(options?: ProvideLanguageModelChatResponseOptions): {
	tools?: OpenAIResponsesFunctionToolDef[]
	tool_choice?: OpenAIResponsesToolChoice
} {
	const toolConfig = convertToolsToOpenAI(options)
	if (!toolConfig.tools || toolConfig.tools.length === 0) {
		return {}
	}

	const tools: OpenAIResponsesFunctionToolDef[] = toolConfig.tools.map((t) => {
		const out: OpenAIResponsesFunctionToolDef = {
			type: 'function',
			name: t.function.name,
		}
		if (t.function.description) {
			out.description = t.function.description
		}
		if (t.function.parameters) {
			out.parameters = t.function.parameters
		}
		return out
	})

	let tool_choice: OpenAIResponsesToolChoice | undefined
	if (toolConfig.tool_choice === 'auto' || toolConfig.tool_choice === 'none' || toolConfig.tool_choice === 'required') {
		tool_choice = toolConfig.tool_choice
	}

	if (tool_choice !== undefined) {
		return { tools, tool_choice }
	}
	return { tools }
}

export interface OpenAIResponsesFunctionToolDef {
	type: 'function'
	name: string
	description?: string
	parameters?: object
}

export type OpenAIResponsesToolChoice = 'auto' | 'none' | 'required'

/**
 * Build the Responses request body fields shared across requests: instructions,
 * reasoning configuration, tools, extra body parameters, and the encrypted
 * reasoning include.
 */
export class ResponsesRequestBuilder {
	prepareRequestBody(
		rb: Record<string, unknown>,
		instructions: string | undefined,
		um: OpenCodeGoModelItem | undefined,
		options?: ProvideLanguageModelChatResponseOptions
	): Record<string, unknown> {
		const isPlainObject = (v: unknown): v is Record<string, unknown> =>
			!!v && typeof v === 'object' && !Array.isArray(v)
		const isArray = (v: unknown): v is unknown[] => Array.isArray(v)

		// Add system content if we extracted it
		if (instructions) {
			rb['instructions'] = instructions
		}

		// max_output_tokens
		if (um?.max_completion_tokens !== undefined) {
			rb['max_output_tokens'] = um.max_completion_tokens
		}

		// OpenAI reasoning configuration
		if (um?.enable_thinking) {
			if (um.reasoning_effort !== undefined) {
				const existing = isPlainObject(rb['reasoning']) ? { ...rb['reasoning'] } : {}
				rb['reasoning'] = {
					...existing,
					effort: um.reasoning_effort,
				}
			}
		} else {
			// Explicitly disable reasoning so the server does not fall back to its default.
			const existing = isPlainObject(rb['reasoning']) ? { ...rb['reasoning'] } : {}
			rb['reasoning'] = {
				...existing,
				effort: 'none',
			}
		}

		// tools
		const toolConfig = convertToolsToOpenAIResponses(options)
		if (toolConfig.tools) {
			rb['tools'] = toolConfig.tools
		}
		if (toolConfig.tool_choice) {
			rb['tool_choice'] = toolConfig.tool_choice
		}

		// Extra body parameters
		if (um?.extra && typeof um.extra === 'object') {
			for (const [key, value] of Object.entries(um.extra)) {
				if (value !== undefined) {
					// Deep-merge reasoning config so `extra.reasoning` doesn't clobber `reasoning.effort`.
					if (key === 'reasoning' && isPlainObject(value) && isPlainObject(rb['reasoning'])) {
						rb['reasoning'] = { ...rb['reasoning'], ...value }
						continue
					}
					if (key === 'tools' && isArray(value) && isArray(rb['tools'])) {
						rb['tools'] = [...rb['tools'], ...value]
					} else {
						rb[key] = value
					}
				}
			}
		}

		// Request encrypted reasoning content so it can be round-tripped in
		// subsequent requests (see processReasoningItem / convertMessages).
		// Gated to match convertMessages (the provider toggles enable_thinking
		// and include_reasoning_in_request together): reasoning must be enabled
		// and forwarded, otherwise the include is meaningless and a strict
		// gateway may reject the unknown value.
		const includeEncryptedReasoning = !!um?.enable_thinking && (um.include_reasoning_in_request ?? true)
		if (includeEncryptedReasoning) {
			const existingInclude = isArray(rb['include']) ? rb['include'] : []
			rb['include'] = Array.from(new Set([...existingInclude, 'reasoning.encrypted_content']))
		}

		return rb
	}
}
