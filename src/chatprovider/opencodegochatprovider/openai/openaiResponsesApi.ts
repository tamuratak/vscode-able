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
} from 'vscode'

import type { OpenCodeGoModelItem } from '../types.js'
import type { OpenAIToolCall } from './openaiTypes.js'

import {
	isImageMimeType,
	createDataUrl,
	isToolResultPart,
	collectToolResultText,
	convertToolsToOpenAI,
	tryParseJSONObject,
	mapRole,
} from '../utils.js'

import { APIUsage, CommonApi } from '../commonApi.js'
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
	output: string
	id: string
	status: 'completed'
}

export interface ResponsesReasoning {
	type: 'reasoning'
	summary: ResponsesContentPart[]
	id: string
	status: 'completed'
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
	if (toolConfig.tool_choice === 'auto') {
		tool_choice = 'auto'
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

export type OpenAIResponsesToolChoice = 'auto' | { type: 'function'; name: string }

export class OpenaiResponsesApi extends CommonApi<ResponsesInputItem, Record<string, unknown>> {
	private _responseId: string | null = null
	private _hasEmittedThinking = false
	private _hasEmittedText = false
	private _usage: APIUsage | undefined

	constructor(modelId: string) {
		super(modelId)
	}

	get responseId(): string | null {
		return this._responseId
	}

	convertMessages(
		messages: readonly LanguageModelChatRequestMessage[],
		modelConfig: { includeReasoningInRequest: boolean }
	): ResponsesInputItem[] {
		const out: ResponsesInputItem[] = []

		for (const m of messages) {
			const role = mapRole(m)
			const textParts: string[] = []
			const imageParts: vscode.LanguageModelDataPart[] = []
			const toolCalls: OpenAIToolCall[] = []
			const toolResults: { callId: string; content: string }[] = []
			const thinkingParts: string[] = []

			for (const part of m.content ?? []) {
				if (part instanceof vscode.LanguageModelTextPart) {
					textParts.push(part.value)
				} else if (part instanceof vscode.LanguageModelDataPart && isImageMimeType(part.mimeType)) {
					imageParts.push(part)
				} else if (part instanceof vscode.LanguageModelToolCallPart) {
					const id = part.callId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
					const args = JSON.stringify(part.input ?? {})
					toolCalls.push({ id, type: 'function', function: { name: part.name, arguments: args } })
				} else if (isToolResultPart(part)) {
					const callId = (part as { callId?: string }).callId ?? ''
					const content = collectToolResultText(part as { content?: readonly unknown[] })
					toolResults.push({ callId, content })
				} else if (part instanceof vscode.LanguageModelThinkingPart && modelConfig.includeReasoningInRequest) {
					const content = Array.isArray(part.value) ? part.value.join('') : part.value
					thinkingParts.push(content)
				}
			}

			const joinedText = textParts.join('').trim()
			const joinedThinking = thinkingParts.join('').trim()

			// assistant message (optional)
			if (role === 'assistant') {
				if (joinedText) {
					out.push({
						role: 'assistant',
						content: [{ type: 'output_text', text: joinedText }],
						type: 'message',
						id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
						status: 'completed',
					})
				}

				if (joinedThinking) {
					out.push({
						summary: [{ type: 'summary_text', text: joinedThinking }],
						type: 'reasoning',
						id: `tk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
						status: 'completed',
					})
				}

				for (const tc of toolCalls) {
					out.push({
						type: 'function_call',
						id: `fc_${tc.id}`,
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
				out.push({
					type: 'function_call_output',
					call_id: tr.callId,
					output: tr.content || '',
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
				this._systemContent = joinedText
			}
		}

		// the last user message may be incomplete
		if (out.length > 0) {
			const lastItem = out[out.length - 1]
			if (lastItem && typeof lastItem === 'object' && 'type' in lastItem) {
				const item = lastItem as unknown as Record<string, unknown>
				if (item['type'] === 'message' && item['role'] === 'user') {
					item['status'] = 'incomplete'
				}
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

		// Add system content if we extracted it
		if (this._systemContent) {
			rb['instructions'] = this._systemContent
		}

		// temperature
		if (um?.temperature !== undefined && um.temperature !== null) {
			rb['temperature'] = um.temperature
		}

		// top_p
		if (um?.top_p !== undefined && um.top_p !== null) {
			rb['top_p'] = um.top_p
		}

		// max_output_tokens
		if (um?.max_completion_tokens !== undefined) {
			rb['max_output_tokens'] = um.max_completion_tokens
		}

		// OpenAI reasoning configuration (only set when thinking is enabled)
		if (um?.enable_thinking && um.reasoning_effort !== undefined) {
			const existing = isPlainObject(rb['reasoning']) ? { ...rb['reasoning'] } : {}
			rb['reasoning'] = {
				...existing,
				effort: um.reasoning_effort,
			}
		}

		// thinking (Volcengine provider)
		if (um?.enable_thinking) {
			rb['thinking'] = { type: 'enabled' }
			if (um.thinking_budget !== undefined) {
				(rb['thinking'] as Record<string, unknown>)['budget_tokens'] = um.thinking_budget
			}
		} else {
			rb['thinking'] = { type: 'disabled' }
		}

		// OpenRouter/OpenCode Go reasoning configuration
		if (um?.reasoning !== undefined && um.reasoning.enabled !== false) {
			const reasoningObj: Record<string, unknown> = {}
			const effort = um.reasoning.effort
			if (effort && effort !== 'auto') {
				reasoningObj['effort'] = effort
			} else {
				reasoningObj['max_tokens'] = um.reasoning.max_tokens || 2000
			}
			if (um.reasoning.exclude !== undefined) {
				reasoningObj['exclude'] = um.reasoning.exclude
			}
			// Merge with existing reasoning config
			if (isPlainObject(rb['reasoning'])) {
				rb['reasoning'] = { ...rb['reasoning'], ...reasoningObj }
			} else {
				rb['reasoning'] = reasoningObj
			}
		}

		// stop
		if (options?.modelOptions) {
			const mo = options.modelOptions as Record<string, unknown>
			if (typeof mo['stop'] === 'string' || Array.isArray(mo['stop'])) {
				rb['stop'] = mo['stop']
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

		// Extra model parameters
		if (um?.top_k !== undefined) { rb['top_k'] = um.top_k }
		if (um?.min_p !== undefined) { rb['min_p'] = um.min_p }
		if (um?.frequency_penalty !== undefined) { rb['frequency_penalty'] = um.frequency_penalty }
		if (um?.presence_penalty !== undefined) { rb['presence_penalty'] = um.presence_penalty }
		if (um?.repetition_penalty !== undefined) { rb['repetition_penalty'] = um.repetition_penalty }

		// Extra body parameters
		if (um?.extra && typeof um.extra === 'object') {
			for (const [key, value] of Object.entries(um.extra)) {
				if (value !== undefined) {
					// Deep-merge reasoning config so `extra.reasoning` doesn't clobber `reasoning.effort`.
					if (key === 'reasoning' && isPlainObject(value) && isPlainObject(rb['reasoning'])) {
						rb['reasoning'] = { ...rb['reasoning'], ...value }
						continue
					}
					if (key === 'tools' && Array.isArray(value) && Array.isArray(rb['tools'])) {
						rb['tools'] = [...(rb['tools'] as unknown[]), ...(value as unknown[])]
					} else {
						rb[key] = value
					}
				}
			}
		}

		return rb
	}

	async processStreamingResponse(
		responseBody: ReadableStream<Uint8Array>,
		progress: Progress<LanguageModelResponsePart2>,
		token: CancellationToken
	): Promise<void> {
		this._responseId = null
		this._usage = undefined
		const modelId = this._modelId
		logger.debug('responses.stream.start', { modelId })
		const reader = responseBody.getReader()
		const decoder = new TextDecoder()
		let buffer = ''

		try {
			while (true) {
				if (token.isCancellationRequested) {
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
					if (!line.startsWith('data:')) {
						continue
					}
					const data = line.slice(5).trim()
					logger.debug('responses.stream.chunk', { modelId, data })
					if (data === '[DONE]') {
						this.flushToolCallBuffers(progress)
						continue
					}

					try {
						const parsed = JSON.parse(data) as Record<string, unknown>
						await this.processEvent(parsed, progress)
					} catch (e) {
						logger.error('responses.stream.chunk.error', {
							modelId,
							error: e instanceof Error ? e.message : String(e),
							data,
						})
					}
				}
			}
			logger.debug('responses.stream.done', { modelId, responseId: this._responseId ?? '' })
		} catch (e) {
			logger.error('responses.stream.error', { modelId, error: e instanceof Error ? e.message : String(e) })
			throw e
		} finally {
			reader.releaseLock()
			this.reportEndThinking(progress)
			this.reportUsage(progress)
		}
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

	private processXmlThinkBlocks(text: string, progress: Progress<LanguageModelResponsePart2>): { emittedAny: boolean } {
		let emittedAny = false
		let remaining = text

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
				this.reportEndThinking(progress)
				this.processTextContent(beforeText, progress)
			}

			// Find the closing tag
			const closeIndex = remaining.indexOf(closeTag, openIndex + openTag.length)
			if (closeIndex === -1) {
				// No closing tag yet - treat the rest as thinking content
				const thinkingContent = remaining.slice(openIndex + openTag.length)
				if (thinkingContent) {
					this.bufferThinkingContent(thinkingContent, progress)
					emittedAny = true
				}
				remaining = ''
			} else {
				// Extract thinking content between tags
				const thinkingContent = remaining.slice(openIndex + openTag.length, closeIndex)
				if (thinkingContent) {
					this.bufferThinkingContent(thinkingContent, progress)
					emittedAny = true
				}
				this.reportEndThinking(progress)
				remaining = remaining.slice(closeIndex + closeTag.length)
			}
		}

		// If there's remaining text after all think blocks, emit it
		if (remaining) {
			this.processTextContent(remaining, progress)
			emittedAny = true
		}

		return { emittedAny }
	}

	private reportEndThinking(_progress: Progress<LanguageModelResponsePart2>): void {
		if (this._currentThinkingId) {
			this.endThinking()
		}
	}

	private reportUsage(progress: Progress<LanguageModelResponsePart2>): void {
		if (!this._usage) {
			return
		}
		progress.report(new vscode.LanguageModelDataPart(
			new TextEncoder().encode(JSON.stringify(this._usage)),
			'usage'
		))
	}

	private processOutputTextChunk(text: string, progress: Progress<LanguageModelResponsePart2>): void {
		if (!text) {
			return
		}
		// Process XML think blocks or text content (mutually exclusive)
		const xmlRes = this.processXmlThinkBlocks(text, progress)
		if (!xmlRes.emittedAny) {
			// If there's an active thinking sequence, end it first
			this.reportEndThinking(progress)

			// Only process text content if no XML think blocks were emitted
			const res = this.processTextContent(text, progress)
			if (res.emittedAny) {
				this._hasEmittedAssistantText = true
				this._hasEmittedText = true
			}
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
				return
			}

			// Output text delta events
			case 'response.output_text.delta':
			case 'response.refusal.delta': {
				this._hasEmittedText = false
				const delta = this.coerceText(event['delta'])
				this.processOutputTextChunk(delta, progress)
				return
			}

			// Output text done events
			case 'response.output_text.done': {
				// Some gateways only emit a final "done" payload (no deltas).
				if (this._hasEmittedText) {
					this._hasEmittedText = false
					return
				}
				const text = this.coerceText(event['text'])
				this.processOutputTextChunk(text, progress)
				return
			}
			case 'response.refusal.done': {
				return
			}

			// Reasoning delta events
			case 'response.reasoning.delta':
			case 'response.reasoning_text.delta':
			case 'response.reasoning_summary.delta':
			case 'response.reasoning_summary_text.delta':
			case 'response.thinking.delta':
			case 'response.thinking_summary.delta':
			case 'response.thought.delta':
			case 'response.thought_summary.delta': {
				this._hasEmittedThinking = false
				this.processReasoningText(event, progress)
				return
			}

			// Reasoning done events
			case 'response.reasoning.done':
			case 'response.reasoning_text.done':
			case 'response.reasoning_summary.done':
			case 'response.reasoning_summary_text.done':
			case 'response.thinking.done':
			case 'response.thinking_summary.done':
			case 'response.thought.done':
			case 'response.thought_summary.done': {
				if (this._hasEmittedThinking) {
					this.reportEndThinking(progress)
					this._hasEmittedThinking = false
					return
				}

				this.processReasoningText(event, progress)
				this.reportEndThinking(progress)
				return
			}

			// Tool call events
			case 'response.function_call_arguments.delta':
			case 'response.function_call_arguments.done': {
				this.reportEndThinking(progress)

				// If first tool call appears after text, emit a whitespace to flush UI buffers.
				if (!this._emittedBeginToolCallsHint && this._hasEmittedAssistantText) {
					progress.report(new vscode.LanguageModelTextPart(' '))
					this._emittedBeginToolCallsHint = true
				}

				const idx = (event['output_index'] as number) ?? 0
				if (this._completedToolCallIndices.has(idx)) {
					return
				}

				const callId = this.getCallIdFromEvent(event)
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
				if (!buf.id && callId) {
					buf.id = callId
				}
				if (!buf.name && name) {
					buf.name = name
				}

				if (eventType === 'response.function_call_arguments.delta') {
					if (chunk) { buf.args += chunk }
				} else {
					// "done" events typically provide the full argument string.
					buf.args = chunk
				}
				this._toolCallBuffers.set(idx, buf)

				this.tryEmitBufferedToolCall(idx, progress)
				if (eventType === 'response.function_call_arguments.done') {
					this.flushToolCallBuffers(progress)
				}
				return
			}

			case 'response.output_item.added':
			case 'response.output_item.done': {
				const item = event['item'] && typeof event['item'] === 'object' ? (event['item'] as Record<string, unknown>) : null
				if (!item || item['type'] !== 'function_call') {
					return
				}

				this.reportEndThinking(progress)

				// If first tool call appears after text, emit a whitespace to flush UI buffers.
				if (!this._emittedBeginToolCallsHint && this._hasEmittedAssistantText) {
					progress.report(new vscode.LanguageModelTextPart(' '))
					this._emittedBeginToolCallsHint = true
				}

				const idx = (event['output_index'] as number) ?? 0
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

				this.tryEmitBufferedToolCall(idx, progress)
				if (eventType === 'response.output_item.done') {
					this.flushToolCallBuffers(progress)
				}
				return
			}

			case 'response.completed':
			case 'response.done': {
				// End of message - ensure thinking is ended and flush all tool calls
				this.flushToolCallBuffers(progress)
				this.reportEndThinking(progress)
				// Capture usage from the completed event
				const usage = event['usage'] ?? (event['response'] as Record<string, unknown>)?.['usage']
				if (usage && typeof usage === 'object') {
					const u = usage as Record<string, unknown>
					this._usage = {
						prompt_tokens: Number(u['input_tokens'] ?? 0),
						completion_tokens: Number(u['output_tokens'] ?? 0),
						total_tokens: Number(u['total_tokens'] ?? 0),
						prompt_tokens_details: u['input_tokens_details']
							? { cached_tokens: Number((u['input_tokens_details'] as Record<string, unknown>)['cached_tokens'] ?? 0) }
							: undefined,
					}
					logger.debug('usage.capture', { modelId: this._modelId, usage: this._usage })
				}
				return
			}
			default: {
				return
			}
		}
	}

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
	) {
		const candidates = [
			this.coerceText(event['delta']),
			this.coerceText(event['text']),
			this.coerceText(event['reasoning']),
			this.coerceText(event['summary']),
		].filter(Boolean)

		for (const chunk of candidates) {
			if (this.looksLikeReasoningConfigValue(chunk)) {
				continue
			}
			this.bufferThinkingContent(chunk, progress)
			break
		}
	}

	private getCallIdFromEvent(event: Record<string, unknown>): string {
		const callIdRaw = event['call_id'] ?? event['callId'] ?? event['id'] ?? event['item_id']
		return typeof callIdRaw === 'string' ? callIdRaw : ''
	}

	private tryEmitBufferedToolCall(idx: number, progress: Progress<LanguageModelResponsePart2>): void {
		const buf = this._toolCallBuffers.get(idx)
		if (!buf || !buf.id || !buf.name) {
			return
		}
		if (!buf.args.trim()) {
			return
		}
		const parsed = tryParseJSONObject(buf.args.trim())
		if (!parsed.ok) {
			return
		}
		let parameters = parsed.value
		parameters = this.adjustReadFileParameters(buf.name, parameters)
		progress.report(new vscode.LanguageModelToolCallPart(buf.id, buf.name, parameters))
		this._toolCallBuffers.delete(idx)
		this._completedToolCallIndices.add(idx)
	}

	async *createMessage(
		model: OpenCodeGoModelItem,
		systemPrompt: string,
		messages: { role: string; content: string }[],
		baseUrl: string,
		apiKey: string
	): AsyncGenerator<{ type: 'text'; text: string }> {
		// Convert to Responses API format
		const input: ResponsesInputItem[] = []

		// Add system prompt as a system message or via instructions
		if (systemPrompt) {
			input.push({
				role: 'system',
				content: [{ type: 'input_text', text: systemPrompt }],
				type: 'message',
				id: `msg_sys_${Date.now()}`,
				status: 'completed',
			})
		}

		// Add user/assistant messages
		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i]
			const role = msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system' ? msg.role : 'user'
			input.push({
				role,
				content: [{ type: 'input_text', text: msg.content }],
				type: 'message',
				id: `msg_${Date.now()}_${i}`,
				status: 'completed',
			})
		}

		// Build request body
		let requestBody: Record<string, unknown> = {
			model: model.id,
			input,
			stream: true,
		}

		requestBody = this.prepareRequestBody(requestBody, model, undefined)

		const headers = CommonApi.prepareHeaders(apiKey, model.apiType ?? 'chat-completions', model.headers)

		const url = `${baseUrl.replace(/\/+$/, '')}/responses`

		// Make the API request
		const response = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(requestBody),
		})

		if (!response.ok) {
			const errorText = await response.text()
			throw new Error(`OpenAI Responses API request failed: [${response.status}] ${response.statusText}\n${errorText}`)
		}

		if (!response.body) {
			throw new Error('No response body from OpenAI Responses API')
		}

		// Process SSE streaming response
		const reader = response.body.getReader()
		const decoder = new TextDecoder()
		let buffer = ''

		try {
			while (true) {
				const { done, value } = await reader.read()
				if (done) { break }

				buffer += decoder.decode(value, { stream: true })
				const lines = buffer.split('\n')
				buffer = lines.pop() || ''

				for (const line of lines) {
					if (!line.startsWith('data:')) {
						continue
					}
					const data = line.slice(5).trim()
					if (data === '[DONE]') { continue }

					try {
						const parsed = JSON.parse(data) as Record<string, unknown>
						const eventType = typeof parsed['type'] === 'string' ? parsed['type'] : ''

						// Only handle text output events, skip reasoning/thinking events
						const textOutputEvents = ['response.output_text.delta']

						const isTextEvent = textOutputEvents.includes(eventType) || !eventType

						if (isTextEvent) {
							// Extract text from various possible locations
							const output = parsed['output'] as unknown[] | undefined
							const firstOutput = output?.[0] as Record<string, unknown> | undefined
							const firstContent = firstOutput?.['content'] as unknown[] | undefined
							const firstContentText = (firstContent?.[0] as Record<string, unknown> | undefined)?.['text']
							const textSources = [parsed['delta'], parsed['text'], parsed['content'], firstContentText]

							for (const textSource of textSources) {
								if (typeof textSource === 'string' && textSource) {
									yield { type: 'text', text: textSource }
									break
								}
							}
						}

						// Check for completion
						if (parsed['done'] || parsed['type'] === 'response.completed' || parsed['type'] === 'response.done') {
							break
						}
					} catch (e) {
						logger.error('responses.createMessage.chunk.error', {
							error: e instanceof Error ? e.message : String(e),
							data,
						})
					}
				}
			}
		} finally {
			reader.releaseLock()
		}
	}
}
