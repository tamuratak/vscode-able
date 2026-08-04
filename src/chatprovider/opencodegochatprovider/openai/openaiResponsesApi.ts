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
import {
	CancellationToken,
	LanguageModelChatRequestMessage,
	ProvideLanguageModelChatResponseOptions,
	LanguageModelResponsePart2,
	Progress,
	LanguageModelChatInformation,
} from 'vscode'

import type { OpenCodeGoModelItem } from '../types.js'
import type { OpenAIToolCall } from './openaiTypes.js'
import {
	decodeEncryptedReasoningPart,
	encodeEncryptedReasoningPart,
	type EncryptedReasoningData,
} from '../encryptedreasoning.js'

import {
	isImageMimeType,
	createDataUrl,
	isToolResultPart,
	collectToolResultText,
	collectToolResultImages,
	convertToolsToOpenAI,
	mapRole,
} from '../vscodeutils.js'

import { ApiResponseResult, CommonApi } from '../commonApi.js'
import { chunkLogger, logger } from '../logger.js'

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
 * Convert VS Code tool definitions to OpenAI Responses API tool definitions.
 * Responses uses `{ type: "function", name, description, parameters }` (no nested `function` object).
 */
export function convertToolsToOpenAIResponses(options?: vscode.ProvideLanguageModelChatResponseOptions): {
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

export interface ResponsesResult extends ApiResponseResult {
	apiType: 'responses';
	finishReason?: string | undefined;
}

/** Extract the text of a Responses API summary content part, or '' when absent. */
function summaryTextOf(part: unknown): string {
	if (typeof part !== 'object' || part === null || Array.isArray(part)) {
		return ''
	}
	if (!('text' in part)) {
		return ''
	}
	return typeof part['text'] === 'string' ? part['text'] : ''
}

/** Extract the refusal text of a chat-completions style delta object, or '' when absent. */
function refusalTextOf(delta: unknown): string {
	if (typeof delta !== 'object' || delta === null || Array.isArray(delta)) {
		return ''
	}
	if (!('refusal' in delta)) {
		return ''
	}
	return typeof delta['refusal'] === 'string' ? delta['refusal'] : ''
}

/**
 * Responses API client.
 *
 * Instances are single-request: the provider creates a new instance per
 * request (see provider.ts) and never caches them. processStreamingResponse
 * still resets the stream state it owns at the start so a stale instance
 * cannot leak tool call or reasoning state into a new stream.
 */
export class OpenaiResponsesApi extends CommonApi<ResponsesInputItem, Record<string, unknown>> {
	/**
	 * The response id of the current stream, captured only for the debug log.
	 * We intentionally do not send previous_response_id:
	 * - The Zen Go gateway (opencode packages/console/app/src/routes/zen/util/provider/openai.ts)
	 *   normalizes requests through a chat-completions-like intermediate form and
	 *   never forwards previous_response_id to the upstream provider.
	 * - OpenCode's own Responses client defines the option but never sets it.
	 * - This provider is stateless across requests, so the id cannot be retained
	 *   reliably for a retry anyway.
	 * Full-history requests are therefore the effective mode on this gateway.
	 */
	private _responseId: string | null = null
	private _hasEmittedThinking = false
	private _hasEmittedText = false
	/** Combined `output_index:summary_index` keys of reasoning summaries already emitted. */
	private _emittedReasoningSummaryKeys = new Set<string>()
	/** Output indices whose reasoning summary was streamed, for per-item [REDACTED] decisions. */
	private _emittedReasoningSummaryOutputIndices = new Set<number>()
	/** Keys (reasoning item id, or `output:<index>`) of reasoning items already emitted. */
	private _completedReasoningItemKeys = new Set<string>()
	/** Closing tag of a <think> block that spans chunk boundaries, if any. */
	private _openThinkCloseTag: string | null = null

	constructor(modelInfo: LanguageModelChatInformation) {
		super(modelInfo)
	}

	convertMessages(
		messages: readonly LanguageModelChatRequestMessage[],
		modelConfig: { includeReasoningInRequest: boolean }
	): ResponsesInputItem[] {
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

	prepareRequestBody(
		rb: Record<string, unknown>,
		um: OpenCodeGoModelItem | undefined,
		options?: ProvideLanguageModelChatResponseOptions
	): Record<string, unknown> {
		const isPlainObject = (v: unknown): v is Record<string, unknown> =>
			!!v && typeof v === 'object' && !Array.isArray(v)
		const isArray = (v: unknown): v is unknown[] => Array.isArray(v)

		// Add system content if we extracted it
		if (this._systemContent) {
			rb['instructions'] = this._systemContent
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

	async processStreamingResponse(
		responseBody: ReadableStream<Uint8Array>,
		progress: Progress<LanguageModelResponsePart2>,
		token: CancellationToken
	): Promise<ResponsesResult | undefined> {
		this._responseId = null
		this._usage = undefined
		this._finishReason = undefined
		this._hasEmittedThinking = false
		this._hasEmittedText = false
		this._hasEmittedAssistantText = false
		this._emittedBeginToolCallsHint = false
		this._currentThinkingId = null
		this._reasoningLoopDetected = false
		this._toolCallBuffers = new Map()
		this._completedToolCallIndices = new Set()
		this._emittedReasoningSummaryKeys = new Set<string>()
		this._emittedReasoningSummaryOutputIndices = new Set<number>()
		this._completedReasoningItemKeys = new Set<string>()
		this._openThinkCloseTag = null
		const modelId = this.modelId
		logger.debug('responses.stream.start', { modelId })
		const reader = responseBody.getReader()
		const decoder = new TextDecoder()
		let buffer = ''
		let streamEnded = false
		const cancelToken = token.onCancellationRequested(() => reader.cancel().catch(() => undefined))

		try {
			while (true) {
				if (token.isCancellationRequested || this._reasoningLoopDetected || streamEnded) {
					break
				}

				const { done, value } = await reader.read()
				if (done) {
					break
				}

				buffer += decoder.decode(value, { stream: true })
				const lines = buffer.split('\n')
				buffer = lines.pop() || ''

				for (const line of lines) {
					if (token.isCancellationRequested || this._reasoningLoopDetected || streamEnded) {
						break
					}
					if (await this.processDataLine(line, progress, modelId)) {
						streamEnded = true
						break
					}
				}
			}

			// Process any remaining data after EOF (gateways may omit the trailing newline).
			if (buffer.trim() && !token.isCancellationRequested && !this._reasoningLoopDetected && !streamEnded) {
				await this.processDataLine(buffer, progress, modelId)
			}
			logger.debug('responses.stream.done', { modelId, responseId: this._responseId ?? '' })
		} catch (e) {
			if (token.isCancellationRequested) {
				// reader.cancel() from the cancellation callback can reject the
				// pending read; treat that as a clean end rather than an error.
				logger.debug('responses.stream.cancelled', { modelId: this.modelId })
				return undefined
			}
			logger.error('responses.stream.error', { modelId, error: e instanceof Error ? e.message : String(e) })
			throw e
		} finally {
			cancelToken.dispose()
			if (streamEnded || this._reasoningLoopDetected || token.isCancellationRequested) {
				reader.cancel().catch(() => undefined)
			}
			reader.releaseLock()
			this.endThinking()
			if (this._reasoningLoopDetected) {
				this.emitReasoningLoopMessage(progress)
			}
			this.reportUsageData(progress)
			this.emitFallbackResponseIfNeeded(progress)
		}

		if (!this._finishReason) {
			return undefined
		}
		return { apiType: 'responses', finishReason: this._finishReason }
	}

	private async processDataLine(
		line: string,
		progress: Progress<LanguageModelResponsePart2>,
		modelId: string
	): Promise<boolean> {
		// Returns true when the stream ended ([DONE] received), false otherwise.
		if (!line.startsWith('data:')) {
			return false
		}
		const data = line.slice(5).trim()
		chunkLogger.trace('responses.stream.chunk', { modelId, data })
		if (data === '[DONE]') {
			this.warnIfToolCallBuffersNotEmpty('[DONE] received')
			// Same guard as openaiApi: a stream that ends without completing any
			// of its tool calls would otherwise emit empty {} calls; throw to
			// prevent infinite agent loops.
			if (this._completedToolCallIndices.size === 0 && this._toolCallBuffers.size > 0) {
				logger.error('responses.stream.tool_calls_incomplete', {
					modelId,
					bufferedIndices: Array.from(this._toolCallBuffers.keys()),
				})
				throw new Error('Stream ended with incomplete tool calls')
			}
			// Emit complete tool calls; invalid JSON still throws inside
			// flushToolCallBuffer to prevent infinite agent loops.
			this.flushToolCallBuffers(progress)
			return true
		}

		try {
			const parsed: unknown = JSON.parse(data)
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				// Not an event object (e.g. JSON null or an array); ignore.
				return false
			}
			await this.processEvent(parsed as Record<string, unknown>, progress)
		} catch (e) {
			// Debug-only here: the outer catch in processStreamingResponse logs
			// the error once at error level with the same message. Truncate the
			// chunk so a large payload does not flood the log.
			logger.debug('responses.stream.chunk.error', {
				modelId,
				error: e instanceof Error ? e.message : String(e),
				data: data.slice(0, 500),
			})
			throw e
		}
		return false
	}

	private coerceText(value: unknown): string {
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

	private looksLikeReasoningConfigValue(value: string): boolean {
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

	private processXmlThinkBlocks(text: string, progress: Progress<LanguageModelResponsePart2>): { emittedAny: boolean; emittedText: boolean } {
		let emittedAny = false
		let emittedText = false
		let remaining = text

		// Continue a think block that was left open by a previous chunk.
		if (this._openThinkCloseTag) {
			const closeTag = this._openThinkCloseTag
			const closeIndex = remaining.indexOf(closeTag)
			if (closeIndex === -1) {
				// The block is still open; keep buffering as thinking.
				this.bufferThinkingContent(remaining, progress)
				return { emittedAny: true, emittedText: false }
			}
			const thinkingContent = remaining.slice(0, closeIndex)
			if (thinkingContent) {
				this.bufferThinkingContent(thinkingContent, progress)
			}
			this._openThinkCloseTag = null
			this.endThinking()
			remaining = remaining.slice(closeIndex + closeTag.length)
			if (!remaining) {
				// The chunk ended right after the closing tag.
				return { emittedAny: true, emittedText: false }
			}
			// Fall through to process any text following the closing tag.
		}

		while (remaining.length > 0) {
			const thinkOpenMatch = remaining.match(/<(think(?:ing)?)>/)
			if (!thinkOpenMatch || thinkOpenMatch.index === undefined) {
				break
			}

			const openTag = thinkOpenMatch[0]
			const openIndex = thinkOpenMatch.index
			const tagName = thinkOpenMatch[1]
			const closeTag = '</' + tagName + '>'

			// Emit any text before the think block as regular text
			const beforeText = remaining.slice(0, openIndex)
			if (beforeText) {
				this.endThinking()
				this.processTextContent(beforeText, progress)
				emittedText = true
			}

			// Find the closing tag
			const closeIndex = remaining.indexOf(closeTag, openIndex + openTag.length)
			if (closeIndex === -1) {
				// No closing tag yet - treat the rest as thinking content and
				// remember the closing tag for continuation in the next chunk.
				const thinkingContent = remaining.slice(openIndex + openTag.length)
				if (thinkingContent) {
					this.bufferThinkingContent(thinkingContent, progress)
				}
				this._openThinkCloseTag = closeTag
				emittedAny = true
				remaining = ''
			} else {
				// Extract thinking content between tags
				const thinkingContent = remaining.slice(openIndex + openTag.length, closeIndex)
				if (thinkingContent) {
					this.bufferThinkingContent(thinkingContent, progress)
				}
				this.endThinking()
				emittedAny = true
				remaining = remaining.slice(closeIndex + closeTag.length)
			}
		}

		// If there's remaining text after all think blocks, emit it
		if (remaining) {
			this.processTextContent(remaining, progress)
			emittedAny = true
			emittedText = true
		}

		return { emittedAny, emittedText }
	}

	private processOutputTextChunk(text: string, progress: Progress<LanguageModelResponsePart2>): void {
		if (!text) {
			return
		}
		const xmlRes = this.processXmlThinkBlocks(text, progress)
		if (!xmlRes.emittedAny) {
			// If there's an active thinking sequence, end it first
			this.endThinking()

			const res = this.processTextContent(text, progress)
			if (res.emittedAny) {
				this._hasEmittedAssistantText = true
				this._hasEmittedText = true
			}
		} else if (xmlRes.emittedText) {
			this._hasEmittedAssistantText = true
			this._hasEmittedText = true
		} else {
			// Thinking-only chunk: mark the item as emitted so the done event
			// does not re-emit the same content.
			this._hasEmittedText = true
		}
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	private async processEvent(
		event: Record<string, unknown>,
		progress: Progress<LanguageModelResponsePart2>
	): Promise<void> {
		const eventType = typeof event['type'] === 'string' ? event['type'] : ''
		if (!eventType) {
			return
		}

		this.captureResponseIdFromEvent(event)

		switch (eventType) {
			case 'error': {
				const errorText = JSON.stringify(event)
				logger.error('responses.stream.process.error', { errorText })
				throw new Error(`Responses API error event: ${errorText}`)
			}

			// Output text delta events
			case 'response.output_text.delta':
			case 'response.refusal.delta': {
				// Some gateways forward chat-completions style deltas
				// ({ refusal: '...' }) instead of plain strings.
				const delta = this.coerceText(event['delta']) || refusalTextOf(event['delta'])
				this.processOutputTextChunk(delta, progress)
				return
			}

			// Output text done events
			case 'response.output_text.done': {
				// Some gateways only emit a final "done" payload (no deltas).
				// Emit the full text only when no delta produced text; the flag is
				// reset here so a later delta/done pair starts fresh.
				const text = this.coerceText(event['text'])
				if (!this._hasEmittedText) {
					this.processOutputTextChunk(text, progress)
				}
				// The done payload may contain the closing part of a think block
				// that was left open by deltas. Clear the continuation tag so a
				// stale tag does not misclassify later chunks.
				this._openThinkCloseTag = null
				this._hasEmittedText = false
				return
			}
			case 'response.refusal.done': {
				// Some gateways only emit a final "done" payload (no deltas).
				// Emit the refusal text only when no delta produced text, mirroring
				// the output_text.done fallback.
				const refusal = typeof event['refusal'] === 'string' ? event['refusal'] : ''
				if (!this._hasEmittedText) {
					this.processOutputTextChunk(refusal, progress)
				}
				this._openThinkCloseTag = null
				this._hasEmittedText = false
				return
			}

			// Reasoning summary part added events: the standard API delivers an
			// empty snapshot here and the text via deltas, so skip it; gateways
			// that include the full text still deliver deltas or a done event.
			case 'response.reasoning_summary_part.added': {
				return
			}

			// Reasoning summary delta events: multiple deltas arrive per summary.
			case 'response.reasoning_summary.delta':
			case 'response.reasoning_summary_text.delta': {
				this._hasEmittedThinking = false
				const outputIndex = typeof event['output_index'] === 'number' ? event['output_index'] : 0
				const summaryIndex = typeof event['summary_index'] === 'number' ? event['summary_index'] : 0
				const summaryKey = `${outputIndex}:${summaryIndex}`
				// Skip only when the summary was already displayed, e.g. by an
				// early output_item; the key is registered by done events so
				// subsequent deltas of the same summary are not dropped.
				if (this._emittedReasoningSummaryKeys.has(summaryKey)) {
					return
				}
				if (this.processReasoningText(event, progress)) {
					this._hasEmittedThinking = true
					this._emittedReasoningSummaryOutputIndices.add(outputIndex)
				}
				return
			}

			// Other reasoning delta events
			case 'response.reasoning.delta':
			case 'response.reasoning_text.delta':
			case 'response.thinking.delta':
			case 'response.thinking_summary.delta':
			case 'response.thought.delta':
			case 'response.thought_summary.delta': {
				this._hasEmittedThinking = false
				if (this.processReasoningText(event, progress)) {
					this._hasEmittedThinking = true
				}
				return
			}

			// Reasoning summary part done events: finalize the summary. The key is
			// registered here (and by the summary done events) so a duplicate
			// delivery is not re-emitted; done-only gateways deliver the full
			// text only in these events.
			case 'response.reasoning_summary.done':
			case 'response.reasoning_summary_text.done':
			case 'response.reasoning_summary_part.done': {
				const outputIndex = typeof event['output_index'] === 'number' ? event['output_index'] : 0
				const summaryIndex = typeof event['summary_index'] === 'number' ? event['summary_index'] : 0
				const summaryKey = `${outputIndex}:${summaryIndex}`
				if (this._emittedReasoningSummaryKeys.has(summaryKey)) {
					if (this._hasEmittedThinking) {
						this.endThinking()
						this._hasEmittedThinking = false
					}
					return
				}
				if (!this._hasEmittedThinking) {
					// No delta delivered the text; emit the final text here.
					this.processReasoningText(event, progress)
				}
				this._emittedReasoningSummaryKeys.add(summaryKey)
				this._emittedReasoningSummaryOutputIndices.add(outputIndex)
				this.endThinking()
				this._hasEmittedThinking = false
				return
			}

			// Other reasoning done events
			case 'response.reasoning.done':
			case 'response.reasoning_text.done':
			case 'response.thinking.done':
			case 'response.thinking_summary.done':
			case 'response.thought.done':
			case 'response.thought_summary.done': {
				if (this._hasEmittedThinking) {
					this.endThinking()
					this._hasEmittedThinking = false
					return
				}

				this.processReasoningText(event, progress)
				this.endThinking()
				return
			}

			// Tool call events
			case 'response.function_call_arguments.delta':
			case 'response.function_call_arguments.done': {
				this.endThinking()

				// If first tool call appears after text, emit a whitespace to flush UI buffers.
				if (!this._emittedBeginToolCallsHint && this._hasEmittedAssistantText) {
					progress.report(new vscode.LanguageModelTextPart(' '))
					this._emittedBeginToolCallsHint = true
				}

				const idx = typeof event['output_index'] === 'number' ? event['output_index'] : 0
				if (this._completedToolCallIndices.has(idx)) {
					return
				}

				const name = typeof event['name'] === 'string' ? event['name'] : ''
				const chunk =
					eventType === 'response.function_call_arguments.delta'
						? typeof event['delta'] === 'string'
							? event['delta']
							: ''
						: typeof event['arguments'] === 'string'
							? event['arguments']
							: ''

				const buf = this._toolCallBuffers.get(idx) ?? { args: '' }
				// The delta/done events carry no call_id (only item_id, the output
				// item id); the id comes from the output_item events.
				if (!buf.name && name) {
					buf.name = name
				}

				if (eventType === 'response.function_call_arguments.delta') {
					if (chunk) { buf.args += chunk }
				} else if (chunk) {
					// "done" events typically provide the full argument string; skip when
					// absent so accumulated deltas are not clobbered.
					buf.args = chunk
				}
				this._toolCallBuffers.set(idx, buf)

				if (eventType === 'response.function_call_arguments.done') {
					this.flushToolCallBufferWithId(idx, progress)
				}
				return
			}

			case 'response.output_item.added':
			case 'response.output_item.done': {
				const item = event['item'] && typeof event['item'] === 'object' ? (event['item'] as Record<string, unknown>) : null
				if (!item) {
					return
				}
				if (item['type'] === 'reasoning') {
					// Encrypted content is only present in the completed item.
					if (eventType === 'response.output_item.done') {
						const outputIndex = typeof event['output_index'] === 'number' ? event['output_index'] : 0
						const itemId = typeof item['id'] === 'string' ? item['id'] : ''
						const itemKey = itemId || `output:${outputIndex}`
						// Register the key only when the item was actually emitted so
						// a later completed payload can still deliver the encrypted
						// content when the done event omitted it.
						if (!this._completedReasoningItemKeys.has(itemKey) && this.processReasoningItem(item, progress, outputIndex)) {
							this._completedReasoningItemKeys.add(itemKey)
						}
					}
					return
				}
				if (item['type'] !== 'function_call') {
					return
				}

				this.endThinking()

				// If first tool call appears after text, emit a whitespace to flush UI buffers.
				if (!this._emittedBeginToolCallsHint && this._hasEmittedAssistantText) {
					progress.report(new vscode.LanguageModelTextPart(' '))
					this._emittedBeginToolCallsHint = true
				}

				const idx = typeof event['output_index'] === 'number' ? event['output_index'] : 0
				if (this._completedToolCallIndices.has(idx)) {
					return
				}

				const callId = this.getCallIdFromEvent(item)
				const name =
					typeof item['name'] === 'string'
						? item['name']
						: item['function'] &&
							  typeof item['function'] === 'object' &&
							  typeof (item['function'] as Record<string, unknown>)['name'] === 'string'
							? String((item['function'] as Record<string, unknown>)['name'])
							: ''
				const args =
					typeof item['arguments'] === 'string'
						? item['arguments']
						: item['function'] &&
							  typeof item['function'] === 'object' &&
							  typeof (item['function'] as Record<string, unknown>)['arguments'] === 'string'
							? String((item['function'] as Record<string, unknown>)['arguments'])
							: ''

				const buf = this._toolCallBuffers.get(idx) ?? { args: '' }
				if (!buf.id && callId) {
					buf.id = callId
				}
				if (!buf.name && name) {
					buf.name = name
				}
				if (args) {
					buf.args = args
				}
				this._toolCallBuffers.set(idx, buf)

				if (eventType === 'response.output_item.done') {
					this.flushToolCallBufferWithId(idx, progress)
				}
				return
			}

			case 'response.completed':
			case 'response.done': {
				// End of message - ensure thinking is ended and flush all tool calls
				this.flushToolCallBuffers(progress)
				this.endThinking()
				this._finishReason = this.synthesizeFinishReason(event)
				this.captureUsage(event)
				// Gateways that omit output_item events deliver reasoning items and
				// messages only in the completed payload; process any not yet
				// emitted so encrypted content and text are not lost.
				this.processCompletedOutputItems(event, progress)
				return
			}

			case 'response.failed': {
				const response = event['response']
				logger.error('responses.stream.response_failed', { modelId: this.modelId, response })
				throw new Error(`Responses API failed: ${JSON.stringify(response)}`)
			}

			case 'response.incomplete': {
				const response = event['response']
				const responseObj = response && typeof response === 'object' ? (response as Record<string, unknown>) : undefined
				const details = responseObj?.['incomplete_details']
				logger.warn('responses.stream.response_incomplete', { modelId: this.modelId, response })
				// Treat an incomplete response as a normal end (like the chat
				// completions `length` finish reason) instead of a hard error,
				// so the agent turn ends rather than surfacing an exception.
				this.warnIfToolCallBuffersNotEmpty('response.incomplete')
				this.endThinking()
				this._finishReason = this.synthesizeIncompleteFinishReason(details)
				this.captureUsage(event)
				return
			}
			default: {
				return
			}
		}
	}

	// The captured id is used only for the debug log; see the note on _responseId
	// for why previous_response_id is not used.
	private captureResponseIdFromEvent(event: Record<string, unknown>): void {
		if (this._responseId) {
			return
		}

		const responseId = event['response_id']
		if (typeof responseId === 'string' && responseId.trim()) {
			this._responseId = responseId
			return
		}

		const response = event['response']
		if (response && typeof response === 'object' && !Array.isArray(response)) {
			const id = (response as Record<string, unknown>)['id']
			if (typeof id === 'string' && id.trim()) {
				this._responseId = id
			}
		}
	}

	private synthesizeFinishReason(event: Record<string, unknown>): string | undefined {
		const response =
			event['response'] && typeof event['response'] === 'object' && !Array.isArray(event['response'])
				? (event['response'] as Record<string, unknown>)
				: undefined
		if (!response) {
			// Some gateways emit a flat completion event without a nested response object.
			// Fall back to the tool call flush state so a tool-call response is
			// not misclassified as stop.
			return event['status'] === 'completed'
				? this._completedToolCallIndices.size > 0
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
			return this._completedToolCallIndices.size > 0 ? 'tool_calls' : 'stop'
		}
		return undefined
	}

	private captureUsage(event: Record<string, unknown>): void {
		const usage = event['usage'] ?? (event['response'] as Record<string, unknown> | undefined)?.['usage']
		if (!usage || typeof usage !== 'object') {
			return
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
		this._usage = {
			prompt_tokens: Number(u['input_tokens'] ?? 0),
			completion_tokens: Number(u['output_tokens'] ?? 0),
			total_tokens: Number(u['total_tokens'] ?? 0),
			prompt_tokens_details: details,
			completion_tokens_details: completionDetails,
		}
		logger.debug('usage.capture', { modelId: this.modelId, usage: this._usage })
	}

	private synthesizeIncompleteFinishReason(details: unknown): string {
		const reason = details && typeof details === 'object'
			? (details as Record<string, unknown>)['reason']
			: undefined
		return reason === 'content_filter' ? 'content_filter' : 'length'
	}

	private processReasoningText(
		event: Record<string, unknown>,
		progress: vscode.Progress<vscode.LanguageModelResponsePart2>
	): boolean {
		const candidates = [
			this.coerceText(event['delta']),
			this.coerceText(event['text']),
			this.coerceText(event['reasoning']),
			this.coerceText(event['summary']),
			this.coerceText(event['part']),
		].filter(Boolean)

		for (const chunk of candidates) {
			if (this.looksLikeReasoningConfigValue(chunk)) {
				continue
			}
			this.bufferThinkingContent(chunk, progress)
			return true
		}
		return false
	}

	/**
	 * Handle a completed reasoning output item. When the model returns
	 * encrypted content (requested via include: ['reasoning.encrypted_content']),
	 * emit it as thinking part metadata and as a stateful marker data part so it
	 * can be round-tripped into later user turns: the built-in Copilot agent
	 * drops thinking parts of previous turns when building the prompt for a
	 * third-party provider, but replays stateful marker data parts. The visible
	 * value shows the item summary when it was not already streamed, and is
	 * shown as [REDACTED] when the summary was streamed or absent, so the user
	 * sees an explicit redaction instead of duplicated or silently hidden
	 * content. Returns true when the item was emitted, false when the item
	 * carried no encrypted content.
	 */
	private processReasoningItem(item: Record<string, unknown>, progress: Progress<LanguageModelResponsePart2>, outputIndex: number): boolean {
		const encryptedContent = typeof item['encrypted_content'] === 'string' ? item['encrypted_content'] : ''
		if (!encryptedContent) {
			return false
		}
		const id = typeof item['id'] === 'string' ? item['id'] : ''
		const summaryParts = Array.isArray(item['summary']) ? item['summary'] : []
		const summaryText = summaryParts.map(part => summaryTextOf(part)).join('')
		const summaryStreamed = this._emittedReasoningSummaryOutputIndices.has(outputIndex)
		const value = summaryText && !summaryStreamed ? summaryText : '[REDACTED]'
		progress.report(new vscode.LanguageModelThinkingPart(value, id || undefined, { encrypted_content: encryptedContent }))
		if (id) {
			// Stateful marker data part replayed by Copilot in later user turns
			// (see encryptedreasoning.ts).
			progress.report(encodeEncryptedReasoningPart(this.modelId, { id, content: encryptedContent }))
			logger.debug('responses.reasoning.marker.emitted', { modelId: this.modelId, id, contentLength: encryptedContent.length })
		}
		// The item may arrive before the summary events (non-standard ordering);
		// mark the summary as emitted so those events are not re-displayed.
		if (!summaryStreamed && summaryText) {
			for (let i = 0; i < summaryParts.length; i++) {
				this._emittedReasoningSummaryKeys.add(`${outputIndex}:${i}`)
			}
			this._emittedReasoningSummaryOutputIndices.add(outputIndex)
		}
		return true
	}

	/**
	 * Emit output items from the completed event's output array that were not
	 * already processed via output_item events. The item's position in the
	 * output array is used as the output index, matching the output_index
	 * semantics of the stream events.
	 */
	private processCompletedOutputItems(event: Record<string, unknown>, progress: Progress<LanguageModelResponsePart2>): void {
		const response =
			event['response'] && typeof event['response'] === 'object' && !Array.isArray(event['response'])
				? (event['response'] as Record<string, unknown>)
				: undefined
		const rawOutput = Array.isArray(event['output']) ? event['output'] : response?.['output']
		if (!Array.isArray(rawOutput)) {
			return
		}
		const output: unknown[] = rawOutput
		for (let i = 0; i < output.length; i++) {
			const item = output[i]
			if (!item || typeof item !== 'object' || Array.isArray(item)) {
				continue
			}
			const record = item as Record<string, unknown>
			if (record['type'] === 'reasoning') {
				const itemId = typeof record['id'] === 'string' ? record['id'] : ''
				const itemKey = itemId || `output:${i}`
				if (this._completedReasoningItemKeys.has(itemKey)) {
					continue
				}
				if (this.processReasoningItem(record, progress, i)) {
					this._completedReasoningItemKeys.add(itemKey)
				}
			} else if (record['type'] === 'function_call') {
				if (this._completedToolCallIndices.has(i)) {
					continue
				}
				const callId = typeof record['call_id'] === 'string' ? record['call_id'] : ''
				const name = typeof record['name'] === 'string' ? record['name'] : ''
				const argumentsText = typeof record['arguments'] === 'string' ? record['arguments'] : ''
				if (!callId) {
					// Same policy as flushToolCallBufferWithId: never emit a tool
					// call whose id cannot be matched in the next turn.
					logger.error('responses.stream.tool_call_missing_id', { modelId: this.modelId, idx: i })
					throw new Error('Tool call missing id')
				}
				// Reuse the existing JSON validation and tool-call emission path.
				this._toolCallBuffers.set(i, { id: callId, name, args: argumentsText })
				this.flushToolCallBufferWithId(i, progress)
			} else if (record['type'] === 'message' && !this._hasEmittedAssistantText) {
				// Restore text for done-only gateways that deliver the message
				// only in the completed payload.
				const text = this.extractOutputText(record)
				if (text) {
					this.processOutputTextChunk(text, progress)
					this._hasEmittedAssistantText = true
				}
			}
		}
	}

	private extractOutputText(item: Record<string, unknown>): string {
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

	/**
	 * Flush a buffered tool call, requiring a real call id. The arguments
	 * delta/done events never carry the call id, so a stream that omits the
	 * output_item events cannot produce a tool call whose id matches the
	 * tool result in the next turn; fail instead of emitting a fake id.
	 */
	private flushToolCallBufferWithId(idx: number, progress: Progress<LanguageModelResponsePart2>): void {
		const buf = this._toolCallBuffers.get(idx)
		if (!buf?.id) {
			logger.error('responses.stream.tool_call_missing_id', { modelId: this.modelId, idx })
			throw new Error('Tool call missing id')
		}
		this.flushToolCallBuffer(idx, progress)
	}

	private getCallIdFromEvent(event: Record<string, unknown>): string {
		// The arguments delta/done events carry only item_id (the output item
		// id, fc_*), never the tool call id (call_*); falling back to item_id
		// would emit a mismatched id that breaks the next turn's tool results.
		// The call id is obtained from the output_item events instead.
		const callIdRaw = event['call_id'] ?? event['callId']
		return typeof callIdRaw === 'string' ? callIdRaw : ''
	}

}
