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
import { createEncryptedReasoningParts } from '../encryptedreasoning.js'

import { ApiResponseResult, CommonApi } from '../commonApi.js'
import { chunkLogger, finalResponseLogger, logger } from '../logger.js'
import { ResponsesMessageConverter, type ResponsesInputItem } from './responsesapilib/responsesMessageConverter.js'
import { ResponsesRequestBuilder } from './responsesapilib/responsesRequestBuilder.js'
import {
	coerceText,
	extractOutputText,
	extractUsage,
	getCallIdFromEvent,
	looksLikeReasoningConfigValue,
	refusalTextOf,
	summaryTextOf,
	synthesizeFinishReason,
	synthesizeIncompleteFinishReason,
} from './responsesapilib/responsesEventUtils.js'

export type {
	ResponsesContentPart,
	ResponsesFunctionCall,
	ResponsesFunctionCallOutput,
	ResponsesInputItem,
	ResponsesInputMessage,
	ResponsesReasoning,
} from './responsesapilib/responsesMessageConverter.js'
export { convertToolsToOpenAIResponses } from './responsesapilib/responsesRequestBuilder.js'
export type { OpenAIResponsesFunctionToolDef, OpenAIResponsesToolChoice } from './responsesapilib/responsesRequestBuilder.js'

export interface ResponsesResult extends ApiResponseResult {
	apiType: 'responses';
	finishReason?: string | undefined;
}

/** Errors raised by the Responses stream processing, classified by code. */
export class ResponsesStreamError extends Error {
	constructor(
		message: string,
		public readonly code: ResponsesStreamErrorCode,
		options?: { cause?: unknown }
	) {
		super(message, options)
		this.name = 'ResponsesStreamError'
	}
}

export type ResponsesStreamErrorCode = 'inactivity_timeout' | 'stream_timeout' | 'no_terminal_event'

/** Options for the Responses API client. Timeouts are finite positive numbers. */
export interface OpenaiResponsesApiOptions {
	/** Drop the stream when no data arrives for this long (default 120s). */
	inactivityTimeoutMs?: number
	/** Bound the streaming phase of the request (default 600s); the HTTP connect phase is bounded by the provider. */
	streamTimeoutMs?: number
}

function validateTimeoutMs(value: number | undefined, name: string, fallback: number): number {
	if (value === undefined) {
		return fallback
	}
	if (!Number.isFinite(value) || value <= 0) {
		throw new TypeError(`${name} must be a finite positive number`)
	}
	return value
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
	/** Set when a terminal event (response.completed / response.incomplete) was processed; the read loop stops so rogue later events are ignored. */
	private _terminalEventEncountered = false
	/** Number of parsed events processed in the current stream, for the done log. */
	private _processedEventCount = 0
	/** Drop the stream when no data arrives for this long (a gateway may keep the connection open without ever delivering a terminal event). */
	public static readonly DEFAULT_INACTIVITY_TIMEOUT_MS = 120_000
	/** Bound the streaming phase so a slow-but-alive gateway cannot hold the turn forever; the HTTP connect phase is bounded by the provider. */
	public static readonly DEFAULT_STREAM_TIMEOUT_MS = 600_000

	private readonly _converter: ResponsesMessageConverter
	private readonly _requestBuilder = new ResponsesRequestBuilder()
	private readonly _inactivityTimeoutMs: number
	private readonly _streamTimeoutMs: number

	constructor(modelInfo: LanguageModelChatInformation, options: OpenaiResponsesApiOptions = {}) {
		super(modelInfo)
		this._converter = new ResponsesMessageConverter(modelInfo)
		this._inactivityTimeoutMs = validateTimeoutMs(options.inactivityTimeoutMs, 'inactivityTimeoutMs', OpenaiResponsesApi.DEFAULT_INACTIVITY_TIMEOUT_MS)
		this._streamTimeoutMs = validateTimeoutMs(options.streamTimeoutMs, 'streamTimeoutMs', OpenaiResponsesApi.DEFAULT_STREAM_TIMEOUT_MS)
	}

	convertMessages(
		messages: readonly LanguageModelChatRequestMessage[],
		modelConfig: { includeReasoningInRequest: boolean }
	): ResponsesInputItem[] {
		return this._converter.convertMessages(messages, modelConfig)
	}

	prepareRequestBody(
		rb: Record<string, unknown>,
		um: OpenCodeGoModelItem | undefined,
		options?: ProvideLanguageModelChatResponseOptions
	): Record<string, unknown> {
		return this._requestBuilder.prepareRequestBody(rb, this._converter.systemContent, um, options)
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
		this._terminalEventEncountered = false
		this._processedEventCount = 0
		this.resetStreamState()
		const modelId = this.modelId
		logger.debug('responses.stream.start', { modelId })
		const reader = responseBody.getReader()
		const decoder = new TextDecoder()
		let buffer = ''
		let streamEnded = false
		let timedOut: 'inactivity' | 'stream' | null = null
		const cancelToken = token.onCancellationRequested(() => reader.cancel().catch(() => undefined))
		const streamTimer = setTimeout(() => {
			if (timedOut !== null) {
				return
			}
			timedOut = 'stream'
			reader.cancel().catch(() => undefined)
		}, this._streamTimeoutMs)

		// Drop the stream when no data arrives for too long: a gateway may keep
		// the connection open without ever delivering a terminal event. The
		// timer is armed only while read() is pending, so chunk processing time
		// is never counted as inactivity and a processing error cannot be
		// masked as a timeout.
		let inactivityTimer: ReturnType<typeof setTimeout> | undefined
		const armInactivityTimer = (): void => {
			inactivityTimer = setTimeout(() => {
				if (timedOut !== null) {
					return
				}
				timedOut = 'inactivity'
				reader.cancel().catch(() => undefined)
			}, this._inactivityTimeoutMs)
		}
		const clearInactivityTimer = (): void => {
			if (inactivityTimer !== undefined) {
				clearTimeout(inactivityTimer)
				inactivityTimer = undefined
			}
		}

		try {
			while (true) {
				if (token.isCancellationRequested || this._reasoningLoopDetected || streamEnded || this._terminalEventEncountered || timedOut !== null) {
					break
				}

				armInactivityTimer()
				let done: boolean
				let value: Uint8Array | undefined
				try {
					const result = await reader.read()
					done = result.done
					value = result.value
				} finally {
					clearInactivityTimer()
				}
				if (done) {
					break
				}

				buffer += decoder.decode(value, { stream: true })
				const lines = buffer.split('\n')
				buffer = lines.pop() || ''

				for (const line of lines) {
					if (token.isCancellationRequested || this._reasoningLoopDetected || streamEnded || this._terminalEventEncountered || timedOut !== null) {
						break
					}
					// A terminal event ends the turn; stop reading even when the
					// stream never closes (misbehaving gateways).
					if ((await this.processDataLine(line, progress, modelId)) || this._terminalEventEncountered) {
						streamEnded = true
						break
					}
				}
			}

			// Process any remaining data after EOF (gateways may omit the trailing newline).
			if (buffer.trim() && !token.isCancellationRequested && !this._reasoningLoopDetected && !streamEnded && timedOut === null) {
				streamEnded = (await this.processDataLine(buffer, progress, modelId)) || this._terminalEventEncountered
			}
			if (timedOut === 'inactivity') {
				throw new Error(`Responses API stream timed out after ${this._inactivityTimeoutMs}ms without data`)
			}
			if (timedOut === 'stream') {
				throw new Error(`Responses API stream exceeded the ${this._streamTimeoutMs}ms streaming timeout`)
			}
			if (!streamEnded && !this._terminalEventEncountered && !this._finishReason && !token.isCancellationRequested && !this._reasoningLoopDetected) {
				logger.error('responses.stream.no_terminal_event', {
					modelId,
					responseId: this._responseId ?? '',
					eventCount: this._processedEventCount,
				})
				throw new ResponsesStreamError('Responses API stream ended before a terminal event', 'no_terminal_event')
			}
			logger.debug('responses.stream.done', {
				modelId,
				responseId: this._responseId ?? '',
				finishReason: this._finishReason ?? '',
				terminalType: this._terminalEventEncountered ? 'terminal_event' : streamEnded ? 'done_marker' : 'eof',
				eventCount: this._processedEventCount,
				toolCallCount: this._completedToolCallIndices.size,
			})
		} catch (e) {
			if (token.isCancellationRequested) {
				// reader.cancel() from the cancellation callback can reject the
				// pending read; treat that as a clean end rather than an error.
				logger.debug('responses.stream.cancelled', { modelId: this.modelId })
				return undefined
			}
			if (timedOut === 'inactivity') {
				// The inactivity timer cancelled the pending read; surface the
				// timeout instead of the raw cancellation error.
				logger.error('responses.stream.inactivity_timeout', { modelId: this.modelId, timeoutMs: this._inactivityTimeoutMs })
				throw new ResponsesStreamError(`Responses API stream timed out after ${this._inactivityTimeoutMs}ms without data`, 'inactivity_timeout', { cause: e })
			}
			if (timedOut === 'stream') {
				logger.error('responses.stream.stream_timeout', { modelId: this.modelId, timeoutMs: this._streamTimeoutMs })
				throw new ResponsesStreamError(`Responses API stream exceeded the ${this._streamTimeoutMs}ms streaming timeout`, 'stream_timeout', { cause: e })
			}
			if (e instanceof ResponsesStreamError) {
				// Already logged at the throw site; propagate as-is.
				throw e
			}
			logger.error('responses.stream.error', { modelId, error: e instanceof Error ? e.message : String(e) })
			throw e
		} finally {
			clearInactivityTimer()
			clearTimeout(streamTimer)
			cancelToken.dispose()
			// Cancel unconditionally: the pending read may still be active when
			// the parser throws, and cancel() on an already-read stream is a
			// no-op, so this is safe on every path.
			await reader.cancel().catch(() => undefined)
			reader.releaseLock()
			this.endThinking()
			if (this._reasoningLoopDetected) {
				this.emitReasoningLoopMessage(progress)
			} else if (this._finishReason === 'stop') {
				finalResponseLogger.info(CommonApi.FINAL_RESPONSE_PREFIX + this._unifiedText)
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
			// The [DONE] marker (chat-completions style) carries no finish
			// reason; synthesize it from the flushed tool calls so pushToolCall
			// can act on them in the agent host.
			if (this._completedToolCallIndices.size > 0) {
				this._finishReason = 'tool_calls'
			}
			return true
		}

		try {
			const parsed: unknown = JSON.parse(data)
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				// Not an event object (e.g. JSON null or an array); ignore.
				return false
			}
			this._processedEventCount++
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
				const delta = coerceText(event['delta']) || refusalTextOf(event['delta'])
				this.processOutputTextChunk(delta, progress)
				return
			}

			// Output text done events
			case 'response.output_text.done': {
				// Some gateways only emit a final "done" payload (no deltas).
				// Emit the full text only when no delta produced text; the flag is
				// reset here so a later delta/done pair starts fresh.
				const text = coerceText(event['text'])
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

				const callId = getCallIdFromEvent(item)
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
				// The completed payload is the canonical source: restore output
				// items first so complete function call arguments overwrite
				// partial delta buffers, then flush whatever remains.
				this.processCompletedOutputItems(event, progress)
				// End of message - ensure thinking is ended and flush all tool calls
				this.flushToolCallBuffers(progress)
				this.endThinking()
				this._finishReason = synthesizeFinishReason(event, this._completedToolCallIndices)
				const usage = extractUsage(event)
				if (usage) {
					this._usage = usage
					logger.debug('usage.capture', { modelId: this.modelId, usage })
				}
				// Stop the read loop so a rogue later event (or an unclosed
				// stream) cannot extend the turn.
				this._terminalEventEncountered = true
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
				// Discard buffered tool calls explicitly: their arguments were
				// cut off mid-stream, and a later [DONE] would otherwise report
				// them as incomplete and fail the whole response.
				this._toolCallBuffers.clear()
				this._completedToolCallIndices.clear()
				this.endThinking()
				this._finishReason = synthesizeIncompleteFinishReason(details)
				// The turn is over; the read loop stops so rogue later events are
				// ignored and an unclosed stream cannot hang the request.
				this._terminalEventEncountered = true
				const usage = extractUsage(event)
				if (usage) {
					this._usage = usage
					logger.debug('usage.capture', { modelId: this.modelId, usage })
				}
				return
			}
			default: {
				// Gateways may emit non-standard event types; record them so
				// protocol drift stays observable instead of silently ignored.
				logger.debug('responses.stream.unknown_event', { modelId: this.modelId, type: eventType })
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

	private processReasoningText(
		event: Record<string, unknown>,
		progress: vscode.Progress<vscode.LanguageModelResponsePart2>
	): boolean {
		const candidates = [
			coerceText(event['delta']),
			coerceText(event['text']),
			coerceText(event['reasoning']),
			coerceText(event['summary']),
			coerceText(event['part']),
		].filter(Boolean)

		for (const chunk of candidates) {
			if (looksLikeReasoningConfigValue(chunk)) {
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
		// The thinking part carries the encrypted content in metadata; the
		// stateful marker data part is replayed by Copilot in later user turns
		// (see encryptedreasoning.ts).
		for (const part of createEncryptedReasoningParts(this.modelId, { id, content: encryptedContent }, value)) {
			progress.report(part)
		}
		if (id) {
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
				const callId = getCallIdFromEvent(record)
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
				const text = extractOutputText(record)
				if (text) {
					this.processOutputTextChunk(text, progress)
					this._hasEmittedAssistantText = true
				}
			}
		}
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

}
