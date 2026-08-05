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
import * as vscode from 'vscode'
import { LanguageModelChatInformation, LanguageModelChatRequestMessage } from 'vscode'

import type { OpenAIToolCall } from './openaiTypes.js'
import { decodeEncryptedReasoningPart, type EncryptedReasoningData } from '../encryptedreasoning.js'

import {
	isImageMimeType,
	createDataUrl,
	isToolResultPart,
	collectToolResultText,
	collectToolResultImages,
	mapRole,
} from '../vscodeutils.js'

import { logger } from '../logger.js'

export interface ResponsesInputMessage {
	role: 'user' | 'assistant' | 'system'
	content: ResponsesContentPart[]
	type?: 'message'
	id?: string
	status?: 'completed' | 'incomplete'
}

export interface ResponsesContentPart {
	type: 'input_text' | 'input_image' | 'output_text' | 'summary_text'
	text?: string
	image_url?: string
	detail?: 'auto'
	annotations?: unknown[]
}

export interface ResponsesFunctionCall {
	type: 'function_call'
	id: string
	call_id: string
	name: string
	arguments: string
	status: 'completed'
}

export interface ResponsesFunctionCallOutput {
	type: 'function_call_output'
	call_id: string
	output: string | ResponsesContentPart[]
	id: string
	status: 'completed'
}

export interface ResponsesReasoning {
	type: 'reasoning'
	summary: ResponsesContentPart[]
	id: string
	status: 'completed'
	encrypted_content?: string
}

export type ResponsesInputItem =
	| ResponsesInputMessage
	| ResponsesFunctionCall
	| ResponsesFunctionCallOutput
	| ResponsesReasoning

/**
 * Convert VS Code chat messages to Responses API input items. System message
 * text is accumulated separately and exposed as {@link systemContent} so the
 * request builder can place it in the top-level `instructions` field.
 */
export class ResponsesMessageConverter {
	private _systemContent: string | undefined

	constructor(private readonly _modelInfo: LanguageModelChatInformation) {}

	get modelId(): string {
		return this._modelInfo.id
	}

	get modelCapabilities() {
		return this._modelInfo.capabilities
	}

	/** System instructions accumulated from system messages, for the `instructions` body field. */
	get systemContent(): string | undefined {
		return this._systemContent
	}

	convertMessages(
		messages: readonly LanguageModelChatRequestMessage[],
		modelConfig: { includeReasoningInRequest: boolean }
	): ResponsesInputItem[] {
		// Reset per call so a reused converter cannot leak system content from
		// a previous request.
		this._systemContent = undefined
		const out: ResponsesInputItem[] = []
		// Same reasoning item id may arrive via a thinking part (same-turn tool
		// call rounds) and via a stateful marker (previous turns), so dedupe
		// across the whole request rather than per message.
		const reasoningItemIds = new Set<string>()

		for (const m of messages) {
			const role = mapRole(m)
			const textParts: string[] = []
			const imageParts: vscode.LanguageModelDataPart[] = []
			const toolCalls: OpenAIToolCall[] = []
			const toolResults: { callId: string; content: string; images: vscode.LanguageModelDataPart[] }[] = []
			const thinkingPartObjects: vscode.LanguageModelThinkingPart[] = []
			const encryptedReasoningDataList: EncryptedReasoningData[] = []

			for (const part of m.content ?? []) {
				if (part instanceof vscode.LanguageModelTextPart) {
					textParts.push(part.value)
				} else if (part instanceof vscode.LanguageModelDataPart && isImageMimeType(part.mimeType) && this.modelCapabilities.imageInput) {
					imageParts.push(part)
				} else if (part instanceof vscode.LanguageModelToolCallPart) {
					const id = part.callId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
					const args = JSON.stringify(part.input ?? {})
					toolCalls.push({ id, type: 'function', function: { name: part.name, arguments: args } })
				} else if (isToolResultPart(part)) {
					const callId = part.callId
					const content = collectToolResultText(part)
					const images = collectToolResultImages(part)
					toolResults.push({ callId, content, images })
				} else if (part instanceof vscode.LanguageModelThinkingPart && modelConfig.includeReasoningInRequest) {
					thinkingPartObjects.push(part)
				} else if (part instanceof vscode.LanguageModelDataPart && modelConfig.includeReasoningInRequest) {
					// Stateful markers replay Copilot's own response-id markers and
					// the encrypted reasoning markers emitted by processReasoningItem.
					const data = decodeEncryptedReasoningPart(part, this.modelId)
					if (data) {
						encryptedReasoningDataList.push(data)
					}
				}
			}

			const joinedText = textParts.join('').trim()

			// assistant message (optional)
			if (role === 'assistant') {
				// Round-trip encrypted reasoning from thinking parts, matching
				// the Copilot extension. Copilot replays thinking parts of the
				// current turn's tool-call rounds, so this covers rounds within
				// one user turn. The Responses API rejects reasoning items whose
				// id it did not issue (400 "Expected an ID that begins with
				// 'rs'"), so plain thinking text is not sent back and encrypted
				// content is forwarded only when the original reasoning item id
				// (rs_*) is preserved via the thinking part metadata.
				for (const part of thinkingPartObjects) {
					const id = typeof part.id === 'string' ? part.id : ''
					if (!id.startsWith('rs')) {
						continue
					}
					const encryptedContent =
						typeof part.metadata?.['encrypted_content'] === 'string'
							? part.metadata['encrypted_content']
							: typeof part.metadata?.['encrypted'] === 'string'
								? part.metadata['encrypted']
								: ''
					if (encryptedContent.length === 0 || reasoningItemIds.has(id)) {
						continue
					}
					reasoningItemIds.add(id)
					out.push({
						type: 'reasoning',
						id,
						summary: [],
						encrypted_content: encryptedContent,
						status: 'completed',
					})
				}

				// Encrypted reasoning carried over across user turns via Copilot's
				// stateful marker data parts (see processReasoningItem and
				// encryptedreasoning.ts). This round trip only works when the
				// upstream forwards the Responses format unchanged (Zen gateway
				// passthrough); gateways that normalize to chat-completions drop
				// reasoning input items.
				for (const data of encryptedReasoningDataList) {
					if (!data.id.startsWith('rs') || data.content.length === 0 || reasoningItemIds.has(data.id)) {
						continue
					}
					reasoningItemIds.add(data.id)
					logger.debug('responses.reasoning.marker.replayed', { modelId: this.modelId, id: data.id })
					out.push({
						type: 'reasoning',
						id: data.id,
						summary: [],
						encrypted_content: data.content,
						status: 'completed',
					})
				}

				if (joinedText) {
					out.push({
						role: 'assistant',
						content: [{ type: 'output_text', text: joinedText, annotations: [] }],
						type: 'message',
						id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
						status: 'completed',
					})
				}

				for (const tc of toolCalls) {
					out.push({
						type: 'function_call',
						// The Zen gateway's chat-completions normalization uses the
						// item id as the tool_call id, so it must equal call_id
						// (tool_call_id of the matching function_call_output).
						id: tc.id,
						call_id: tc.id,
						name: tc.function.name,
						arguments: tc.function.arguments,
						status: 'completed',
					})
				}
			}

			// tool outputs
			for (const tr of toolResults) {
				if (!tr.callId) {
					continue
				}
				let output: string | ResponsesContentPart[]
				if (tr.images.length > 0 && this.modelCapabilities.imageInput) {
					const outputParts: ResponsesContentPart[] = []
					if (tr.content) {
						outputParts.push({ type: 'input_text', text: tr.content })
					}
					for (const imagePart of tr.images) {
						outputParts.push({ type: 'input_image', image_url: createDataUrl(imagePart), detail: 'auto' })
					}
					output = outputParts
				} else {
					output = tr.content || ''
				}
				out.push({
					type: 'function_call_output',
					call_id: tr.callId,
					output,
					id: `fco_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
					status: 'completed',
				})
			}

			// user message
			if (role === 'user') {
				const contentArray: ResponsesContentPart[] = []
				if (joinedText) {
					contentArray.push({ type: 'input_text', text: joinedText })
				}
				for (const imagePart of imageParts) {
					const dataUrl = createDataUrl(imagePart)
					contentArray.push({ type: 'input_image', image_url: dataUrl, detail: 'auto' })
				}
				if (contentArray.length > 0) {
					out.push({
						role: 'user',
						content: contentArray,
						type: 'message',
						status: 'completed',
					})
				}
			}

			// system message (used to build `instructions` in request body)
			if (role === 'system' && joinedText) {
				this._systemContent = this._systemContent && typeof this._systemContent === 'string'
					? `${this._systemContent}\n\n${joinedText}`
					: joinedText
			}
		}

		// the last user message may be incomplete
		if (out.length > 0) {
			const lastItem = out[out.length - 1]
			if (lastItem?.type === 'message' && lastItem.role === 'user') {
				lastItem.status = 'incomplete'
			}
		}
		return out
	}
}
