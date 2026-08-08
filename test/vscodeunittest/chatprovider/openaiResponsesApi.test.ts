import { deepStrictEqual, rejects, strictEqual, throws } from 'node:assert'
import * as vscode from 'vscode'
import { OpenaiResponsesApi, ResponsesStreamError } from '../../../src/chatprovider/opencodegochatprovider/openai/openaiResponsesApi.js'
import { getBuiltInModelConfig, getBuiltInModelInfos } from '../../../src/chatprovider/opencodegochatprovider/models.js'
import type { OpenCodeGoModelItem } from '../../../src/chatprovider/opencodegochatprovider/types.js'
import {
    decodeEncryptedReasoningPart,
    encodeEncryptedReasoningPart,
} from '../../../src/chatprovider/opencodegochatprovider/encryptedreasoning.js'

const RESPONSES_MODEL_ID = 'gpt-5.6-luna'

function makeModelInfo(): vscode.LanguageModelChatInformation {
    const info = getBuiltInModelInfos().find(m => m.id === RESPONSES_MODEL_ID)
    if (!info) {
        throw new Error(`Model not found: ${RESPONSES_MODEL_ID}`)
    }
    return info
}

function makeTextMsg(
    role: vscode.LanguageModelChatMessageRole,
    text: string
): vscode.LanguageModelChatRequestMessage {
    return {
        role,
        content: [new vscode.LanguageModelTextPart(text)],
        name: undefined,
    }
}

function makeUserToolResultMsg(
    callId: string,
    text: string
): vscode.LanguageModelChatRequestMessage {
    return {
        role: vscode.LanguageModelChatMessageRole.User,
        content: [new vscode.LanguageModelToolResultPart(callId, [new vscode.LanguageModelTextPart(text)])],
        name: undefined,
    }
}

function makeAssistantToolCallMsg(
    callId: string,
    name: string,
    input: Record<string, unknown>
): vscode.LanguageModelChatRequestMessage {
    return {
        role: vscode.LanguageModelChatMessageRole.Assistant,
        content: [new vscode.LanguageModelToolCallPart(callId, name, input)],
        name: undefined,
    }
}

function createMockProgress(): {
    progress: vscode.Progress<vscode.LanguageModelResponsePart2>
    reported: vscode.LanguageModelResponsePart2[]
} {
    const reported: vscode.LanguageModelResponsePart2[] = []
    return {
        progress: { report(part) { reported.push(part) } },
        reported,
    }
}

function makeSseStream(events: (string | Record<string, unknown>)[]): ReadableStream<Uint8Array> {
    const lines = events
        .map(e => typeof e === 'string' ? `data: ${e}` : `data: ${JSON.stringify(e)}`)
        .join('\n')
    const encoder = new TextEncoder()
    return new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(encoder.encode(lines + '\n'))
            controller.close()
        },
    })
}

function makeChunkedSseStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder()
    return new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) {
                controller.enqueue(encoder.encode(chunk))
            }
            controller.close()
        },
    })
}

suite('OpenaiResponsesApi.convertMessages', () => {
    test('concatenates multiple system messages into instructions', () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const messages = [
            makeTextMsg(vscode.LanguageModelChatMessageRole.System, 'system one'),
            makeTextMsg(vscode.LanguageModelChatMessageRole.System, 'system two'),
            makeTextMsg(vscode.LanguageModelChatMessageRole.User, 'hello'),
        ]
        api.convertMessages(messages, { includeReasoningInRequest: true })
        const rb = api.prepareRequestBody({ model: RESPONSES_MODEL_ID, input: [], stream: true }, undefined, undefined)
        strictEqual(rb['instructions'], 'system one\n\nsystem two')
    })

    test('keeps call_id consistent between function call and tool output', () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const messages = [
            makeTextMsg(vscode.LanguageModelChatMessageRole.User, 'please check'),
            makeAssistantToolCallMsg('call_1', 'read_file', { filePath: '/a.ts' }),
            makeUserToolResultMsg('call_1', 'file content'),
            makeTextMsg(vscode.LanguageModelChatMessageRole.User, 'next'),
        ]
        const items = api.convertMessages(messages, { includeReasoningInRequest: true })
        const functionCall = items.find(i => i.type === 'function_call')
        const toolOutput = items.find(i => i.type === 'function_call_output')
        strictEqual(functionCall?.type === 'function_call' ? functionCall.call_id : '', 'call_1')
        strictEqual(toolOutput?.type === 'function_call_output' ? toolOutput.call_id : '', 'call_1')
        // The Zen gateway's chat-completions conversion uses the item id as the
        // tool_call id, so it must match call_id (the tool_call_id).
        strictEqual(functionCall?.type === 'function_call' ? functionCall.id : '', 'call_1')
    })

    test('marks the last user message as incomplete', () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const messages = [
            makeTextMsg(vscode.LanguageModelChatMessageRole.User, 'first'),
            makeTextMsg(vscode.LanguageModelChatMessageRole.User, 'last'),
        ]
        const items = api.convertMessages(messages, { includeReasoningInRequest: true })
        const last = items[items.length - 1]
        strictEqual(last.type, 'message')
        strictEqual(last.role, 'user')
        strictEqual(last.status, 'incomplete')
    })

    test('round-trips encrypted thinking and drops plain thinking text', () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const messages = [
            makeTextMsg(vscode.LanguageModelChatMessageRole.User, 'hello'),
            {
                role: vscode.LanguageModelChatMessageRole.Assistant,
                name: undefined,
                content: [
                    new vscode.LanguageModelThinkingPart('plain thinking', 'tk_1'),
                    new vscode.LanguageModelThinkingPart('[REDACTED]', 'rs_abc', { encrypted_content: 'enc-blob' }),
                ],
            },
        ]
        const items = api.convertMessages(messages, { includeReasoningInRequest: true })
        const reasoningItems = items.filter(i => i.type === 'reasoning')
        strictEqual(reasoningItems.length, 1)
        strictEqual(reasoningItems[0].id, 'rs_abc')
        strictEqual(reasoningItems[0].type === 'reasoning' ? reasoningItems[0].encrypted_content : '', 'enc-blob')
        strictEqual(reasoningItems[0].type === 'reasoning' ? reasoningItems[0].summary.length : -1, 0)
    })

    test('round-trips encrypted reasoning via a stateful marker and drops foreign data parts', () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const messages = [
            makeTextMsg(vscode.LanguageModelChatMessageRole.User, 'hello'),
            {
                role: vscode.LanguageModelChatMessageRole.Assistant,
                name: undefined,
                content: [
                    encodeEncryptedReasoningPart(RESPONSES_MODEL_ID, { id: 'rs_abc', content: 'enc-blob' }),
                    // Copilot's own response-id markers are ignored.
                    new vscode.LanguageModelDataPart(new TextEncoder().encode(RESPONSES_MODEL_ID + '\\resp_1'), 'stateful_marker'),
                    new vscode.LanguageModelDataPart(new TextEncoder().encode('junk'), 'application/x-unknown'),
                ],
            },
            makeTextMsg(vscode.LanguageModelChatMessageRole.Assistant, 'answer'),
        ]
        const items = api.convertMessages(messages, { includeReasoningInRequest: true })
        const reasoningItems = items.filter(i => i.type === 'reasoning')
        strictEqual(reasoningItems.length, 1)
        strictEqual(reasoningItems[0].id, 'rs_abc')
        strictEqual(reasoningItems[0].type === 'reasoning' ? reasoningItems[0].encrypted_content : '', 'enc-blob')
        strictEqual(reasoningItems[0].type === 'reasoning' ? reasoningItems[0].summary.length : -1, 0)
        // The reasoning item precedes the assistant message it belongs to.
        const reasoningIndex = items.indexOf(reasoningItems[0])
        const nextItem = items[reasoningIndex + 1]
        strictEqual(nextItem?.type, 'message')
        strictEqual(nextItem && 'role' in nextItem ? nextItem.role : undefined, 'assistant')
    })

    test('round-trips encrypted thinking via the encrypted fallback metadata key', () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const messages = [
            makeTextMsg(vscode.LanguageModelChatMessageRole.User, 'hello'),
            {
                role: vscode.LanguageModelChatMessageRole.Assistant,
                name: undefined,
                content: [new vscode.LanguageModelThinkingPart('[REDACTED]', 'rs_abc', { encrypted: 'enc-blob' })],
            },
        ]
        const items = api.convertMessages(messages, { includeReasoningInRequest: true })
        const reasoningItems = items.filter(i => i.type === 'reasoning')
        strictEqual(reasoningItems.length, 1)
        strictEqual(reasoningItems[0].type === 'reasoning' ? reasoningItems[0].encrypted_content : '', 'enc-blob')
    })

    test('drops encrypted reasoning markers when reasoning is not included in the request', () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const messages = [
            makeTextMsg(vscode.LanguageModelChatMessageRole.User, 'hello'),
            {
                role: vscode.LanguageModelChatMessageRole.Assistant,
                name: undefined,
                content: [encodeEncryptedReasoningPart(RESPONSES_MODEL_ID, { id: 'rs_abc', content: 'enc-blob' })],
            },
            makeTextMsg(vscode.LanguageModelChatMessageRole.Assistant, 'answer'),
        ]
        const items = api.convertMessages(messages, { includeReasoningInRequest: false })
        const reasoningItems = items.filter(i => i.type === 'reasoning')
        strictEqual(reasoningItems.length, 0)
    })

    test('round-trips the stateful marker wire format', () => {
        const part = encodeEncryptedReasoningPart(RESPONSES_MODEL_ID, { id: 'rs_abc', content: 'enc-blob' })
        strictEqual(part.mimeType, 'stateful_marker')
        // Copilot's decodeStatefulMarker splits on the first backslash.
        const decoded = new TextDecoder().decode(part.data)
        strictEqual(decoded.startsWith(RESPONSES_MODEL_ID + '\\'), true)
        strictEqual(decoded.includes('\\'), true)
        const data = decodeEncryptedReasoningPart(part, RESPONSES_MODEL_ID)
        strictEqual(data?.id, 'rs_abc')
        strictEqual(data?.content, 'enc-blob')
    })

    test('deduplicates reasoning items with the same id across thinking parts and markers', () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const messages = [
            makeTextMsg(vscode.LanguageModelChatMessageRole.User, 'hello'),
            // Same reasoning item id arrives both via a thinking part (same-turn
            // tool call round) and via a stateful marker (previous turn), possibly
            // on separate messages.
            {
                role: vscode.LanguageModelChatMessageRole.Assistant,
                name: undefined,
                content: [
                    new vscode.LanguageModelThinkingPart('[REDACTED]', 'rs_dup', { encrypted_content: 'enc-blob' }),
                ],
            },
            {
                role: vscode.LanguageModelChatMessageRole.Assistant,
                name: undefined,
                content: [encodeEncryptedReasoningPart(RESPONSES_MODEL_ID, { id: 'rs_dup', content: 'enc-blob' })],
            },
            makeTextMsg(vscode.LanguageModelChatMessageRole.Assistant, 'answer'),
        ]
        const items = api.convertMessages(messages, { includeReasoningInRequest: true })
        const reasoningItems = items.filter(i => i.type === 'reasoning')
        strictEqual(reasoningItems.length, 1)
        strictEqual(reasoningItems[0].id, 'rs_dup')
        strictEqual(reasoningItems[0].type === 'reasoning' ? reasoningItems[0].encrypted_content : '', 'enc-blob')
    })
})

suite('OpenaiResponsesApi.prepareRequestBody', () => {
    function makeModel(overrides: Partial<OpenCodeGoModelItem>): OpenCodeGoModelItem {
        const base = getBuiltInModelConfig(RESPONSES_MODEL_ID)
        if (!base) {
            throw new Error(`Model not found: ${RESPONSES_MODEL_ID}`)
        }
        return { ...base, ...overrides }
    }

    test('sets reasoning effort when thinking is enabled', () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const rb = api.prepareRequestBody({}, makeModel({ enable_thinking: true, reasoning_effort: 'high' }), undefined)
        deepStrictEqual(rb['reasoning'], { effort: 'high' })
    })

    test('disables reasoning when thinking is not enabled', () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const rb = api.prepareRequestBody({}, makeModel({ enable_thinking: false }), undefined)
        deepStrictEqual(rb['reasoning'], { effort: 'none' })
    })

    test('deep-merges extra reasoning config into the reasoning object', () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const rb = api.prepareRequestBody(
            {},
            makeModel({
                enable_thinking: true,
                reasoning_effort: 'low',
                extra: { reasoning: { summary: 'detailed' } },
            }),
            undefined
        )
        deepStrictEqual(rb['reasoning'], { effort: 'low', summary: 'detailed' })
    })

    test('maps modelOptions.toolMode to tool_choice', () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const options: vscode.ProvideLanguageModelChatResponseOptions = {
            toolMode: vscode.LanguageModelChatToolMode.Auto,
            tools: [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: {} } }],
            modelOptions: { toolMode: 'required' },
            requestInitiator: 'test',
        }
        const rb = api.prepareRequestBody({}, undefined, options)
        strictEqual(rb['tool_choice'], 'required')
        const tools = rb['tools'] as Record<string, unknown>[] | undefined
        strictEqual(tools?.length, 1)
        strictEqual(tools?.[0]?.['name'], 'read_file')
    })

    test('requests encrypted reasoning content via include', () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const rb = api.prepareRequestBody({}, makeModel({ enable_thinking: true }), undefined)
        deepStrictEqual(rb['include'], ['reasoning.encrypted_content'])
    })

    test('merges user-supplied include entries without duplicates', () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const rb = api.prepareRequestBody(
            { include: ['item_id', 'reasoning.encrypted_content'] },
            makeModel({ enable_thinking: true }),
            undefined
        )
        deepStrictEqual(rb['include'], ['item_id', 'reasoning.encrypted_content'])
    })

    test('does not request encrypted reasoning content when thinking is disabled', () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const rb = api.prepareRequestBody({}, makeModel({ enable_thinking: false }), undefined)
        strictEqual(rb['include'], undefined)
    })

    test('does not request encrypted reasoning content when reasoning is not forwarded', () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const rb = api.prepareRequestBody({}, makeModel({ enable_thinking: true, include_reasoning_in_request: false }), undefined)
        strictEqual(rb['include'], undefined)
    })
})

suite('OpenaiResponsesApi.processStreamingResponse', () => {
    test('emits encrypted content from a completed reasoning output item', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: 'rs_1', status: 'completed', summary: [{ type: 'summary_text', text: 'my summary' }], encrypted_content: 'enc-blob' } },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        const thinkingParts = reported.filter(p => p instanceof vscode.LanguageModelThinkingPart)
        strictEqual(thinkingParts.length, 1)
        strictEqual(thinkingParts[0].id, 'rs_1')
        strictEqual(thinkingParts[0].metadata?.['encrypted_content'], 'enc-blob')
        strictEqual(Array.isArray(thinkingParts[0].value) ? thinkingParts[0].value.join('') : thinkingParts[0].value, 'my summary')
        strictEqual(result?.finishReason, 'stop')
        // The encrypted content is also emitted as a data part the chat agent can collect.
        const dataParts = reported.filter(p => p instanceof vscode.LanguageModelDataPart)
        strictEqual(dataParts.length, 1)
        const decoded = decodeEncryptedReasoningPart(dataParts[0], RESPONSES_MODEL_ID)
        strictEqual(decoded?.id, 'rs_1')
        strictEqual(decoded?.content, 'enc-blob')
    })

    test('does not emit a thinking part for a reasoning item without encrypted content', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: 'rs_1', status: 'completed', summary: [{ type: 'summary_text', text: 'my summary' }] } },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } },
        ])
        await api.processStreamingResponse(stream, progress, cts.token)
        const thinkingParts = reported.filter(p => p instanceof vscode.LanguageModelThinkingPart)
        strictEqual(thinkingParts.length, 0)
    })

    test('emits [REDACTED] when the reasoning summary was already streamed', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.reasoning_summary_part.added', output_index: 0, summary_index: 0, part: { type: 'summary_text', text: 'my summary' } },
            { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, delta: 'my summary' },
            { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: 'rs_1', status: 'completed', summary: [{ type: 'summary_text', text: 'my summary' }], encrypted_content: 'enc-blob' } },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } },
        ])
        await api.processStreamingResponse(stream, progress, cts.token)
        const thinkingParts = reported.filter(p => p instanceof vscode.LanguageModelThinkingPart)
        strictEqual(thinkingParts.length, 2)
        strictEqual(Array.isArray(thinkingParts[0].value) ? thinkingParts[0].value.join('') : thinkingParts[0].value, 'my summary')
        strictEqual(Array.isArray(thinkingParts[1].value) ? thinkingParts[1].value.join('') : thinkingParts[1].value, '[REDACTED]')
        strictEqual(thinkingParts[1].id, 'rs_1')
        strictEqual(thinkingParts[1].metadata?.['encrypted_content'], 'enc-blob')
    })

    test('tracks reasoning summary streaming per output item', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, delta: 'first summary' },
            { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: 'rs_1', status: 'completed', summary: [{ type: 'summary_text', text: 'first summary' }], encrypted_content: 'enc-1' } },
            // Same summary_index for a different output item must not collide.
            { type: 'response.reasoning_summary_text.delta', output_index: 1, summary_index: 0, delta: 'second summary' },
            { type: 'response.output_item.done', output_index: 1, item: { type: 'reasoning', id: 'rs_2', status: 'completed', summary: [{ type: 'summary_text', text: 'second summary' }], encrypted_content: 'enc-2' } },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } },
        ])
        await api.processStreamingResponse(stream, progress, cts.token)
        const thinkingParts = reported.filter(p => p instanceof vscode.LanguageModelThinkingPart)
        strictEqual(thinkingParts.length, 4)
        strictEqual(Array.isArray(thinkingParts[0].value) ? thinkingParts[0].value.join('') : thinkingParts[0].value, 'first summary')
        strictEqual(Array.isArray(thinkingParts[1].value) ? thinkingParts[1].value.join('') : thinkingParts[1].value, '[REDACTED]')
        strictEqual(Array.isArray(thinkingParts[2].value) ? thinkingParts[2].value.join('') : thinkingParts[2].value, 'second summary')
        strictEqual(Array.isArray(thinkingParts[3].value) ? thinkingParts[3].value.join('') : thinkingParts[3].value, '[REDACTED]')
    })

    test('emits [REDACTED] when the reasoning item has no summary', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: 'rs_1', status: 'completed', summary: [], encrypted_content: 'enc-blob' } },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } },
        ])
        await api.processStreamingResponse(stream, progress, cts.token)
        const thinkingParts = reported.filter(p => p instanceof vscode.LanguageModelThinkingPart)
        strictEqual(thinkingParts.length, 1)
        strictEqual(Array.isArray(thinkingParts[0].value) ? thinkingParts[0].value.join('') : thinkingParts[0].value, '[REDACTED]')
        strictEqual(thinkingParts[0].id, 'rs_1')
    })

    test('emits a completed reasoning item only once across duplicate events', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const item = { type: 'reasoning', id: 'rs_1', status: 'completed', summary: [{ type: 'summary_text', text: 'my summary' }], encrypted_content: 'enc-blob' }
        const stream = makeSseStream([
            { type: 'response.output_item.done', output_index: 0, item },
            // A duplicate delivery of the same item must not emit twice.
            { type: 'response.output_item.done', output_index: 0, item },
            // The completed payload also contains the item; it must be skipped.
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [item] } },
        ])
        await api.processStreamingResponse(stream, progress, cts.token)
        const thinkingParts = reported.filter(p => p instanceof vscode.LanguageModelThinkingPart)
        strictEqual(thinkingParts.length, 1)
        const dataParts = reported.filter(p => p instanceof vscode.LanguageModelDataPart && p.mimeType === 'stateful_marker')
        strictEqual(dataParts.length, 1)
    })

    test('delivers encrypted content from the completed event when the done event lacked it', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            // The done event carries the item without encrypted content, so the
            // dedup key must not be registered; the completed payload then
            // delivers the full item.
            { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: 'rs_1', status: 'completed', summary: [{ type: 'summary_text', text: 'my summary' }] } },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [{ type: 'reasoning', id: 'rs_1', status: 'completed', summary: [{ type: 'summary_text', text: 'my summary' }], encrypted_content: 'enc-blob' }] } },
        ])
        await api.processStreamingResponse(stream, progress, cts.token)
        const thinkingParts = reported.filter(p => p instanceof vscode.LanguageModelThinkingPart)
        strictEqual(thinkingParts.length, 1)
        strictEqual(thinkingParts[0].id, 'rs_1')
        strictEqual(Array.isArray(thinkingParts[0].value) ? thinkingParts[0].value.join('') : thinkingParts[0].value, 'my summary')
        const dataParts = reported.filter((p): p is vscode.LanguageModelDataPart => p instanceof vscode.LanguageModelDataPart && p.mimeType === 'stateful_marker')
        strictEqual(dataParts.length, 1)
        const decoded = decodeEncryptedReasoningPart(dataParts[0], RESPONSES_MODEL_ID)
        strictEqual(decoded?.id, 'rs_1')
        strictEqual(decoded?.content, 'enc-blob')
    })

    test('round-trips reasoning items delivered only in the completed event', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.output_text.delta', output_index: 0, item_id: 'msg_1', delta: 'Hello' },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [{ type: 'reasoning', id: 'rs_1', status: 'completed', summary: [{ type: 'summary_text', text: 'my summary' }], encrypted_content: 'enc-blob' }] } },
        ])
        await api.processStreamingResponse(stream, progress, cts.token)
        const thinkingParts = reported.filter(p => p instanceof vscode.LanguageModelThinkingPart)
        strictEqual(thinkingParts.length, 1)
        strictEqual(thinkingParts[0].id, 'rs_1')
        strictEqual(Array.isArray(thinkingParts[0].value) ? thinkingParts[0].value.join('') : thinkingParts[0].value, 'my summary')
        const dataParts = reported.filter((p): p is vscode.LanguageModelDataPart => p instanceof vscode.LanguageModelDataPart && p.mimeType === 'stateful_marker')
        strictEqual(dataParts.length, 1)
        const decoded = decodeEncryptedReasoningPart(dataParts[0], RESPONSES_MODEL_ID)
        strictEqual(decoded?.id, 'rs_1')
        strictEqual(decoded?.content, 'enc-blob')
    })

    test('does not duplicate the summary when the item arrives before the summary events', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.output_item.done', output_index: 0, item: { type: 'reasoning', id: 'rs_1', status: 'completed', summary: [{ type: 'summary_text', text: 'my summary' }], encrypted_content: 'enc-blob' } },
            { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, delta: 'my summary' },
            { type: 'response.reasoning_summary_text.done', output_index: 0, summary_index: 0, text: 'my summary' },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } },
        ])
        await api.processStreamingResponse(stream, progress, cts.token)
        const thinkingParts = reported.filter(p => p instanceof vscode.LanguageModelThinkingPart)
        strictEqual(thinkingParts.length, 1)
        strictEqual(Array.isArray(thinkingParts[0].value) ? thinkingParts[0].value.join('') : thinkingParts[0].value, 'my summary')
    })

    test('does not duplicate the summary when output_index is missing', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.reasoning_summary_text.delta', delta: 'my summary' },
            { type: 'response.output_item.done', item: { type: 'reasoning', id: 'rs_1', status: 'completed', summary: [{ type: 'summary_text', text: 'my summary' }], encrypted_content: 'enc-blob' } },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } },
        ])
        await api.processStreamingResponse(stream, progress, cts.token)
        const thinkingParts = reported.filter(p => p instanceof vscode.LanguageModelThinkingPart)
        strictEqual(thinkingParts.length, 2)
        strictEqual(Array.isArray(thinkingParts[0].value) ? thinkingParts[0].value.join('') : thinkingParts[0].value, 'my summary')
        strictEqual(Array.isArray(thinkingParts[1].value) ? thinkingParts[1].value.join('') : thinkingParts[1].value, '[REDACTED]')
    })

    test('emits reasoning summary thinking parts only once', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.reasoning_summary_part.added', output_index: 0, summary_index: 0, part: { type: 'summary_text', text: 'my summary' } },
            { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, delta: 'my summary' },
            { type: 'response.reasoning_summary_text.done', output_index: 0, summary_index: 0, text: 'my summary' },
            { type: 'response.reasoning_summary_part.done', output_index: 0, summary_index: 0, part: { type: 'summary_text', text: 'my summary' } },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        const thinkingParts = reported.filter(p => p instanceof vscode.LanguageModelThinkingPart)
        strictEqual(thinkingParts.length, 1)
        strictEqual(result?.finishReason, 'stop')
    })

    test('emits tool calls only once', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            // Standard order: output_item.added carries the call id; the
            // argument delta/done events carry only item_id.
            { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: '{"filePath":"/a.ts"}' } },
            { type: 'response.function_call_arguments.delta', output_index: 0, item_id: 'fc_1', name: 'read_file', delta: '{"filePath":"/a.ts"}' },
            { type: 'response.function_call_arguments.done', output_index: 0, item_id: 'fc_1', name: 'read_file', arguments: '{"filePath":"/a.ts"}' },
            { type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: '{"filePath":"/a.ts"}' } },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: '{"filePath":"/a.ts"}' }] } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        const toolCallParts = reported.filter(p => p instanceof vscode.LanguageModelToolCallPart)
        strictEqual(toolCallParts.length, 1)
        strictEqual(toolCallParts[0].callId, 'call_1')
        strictEqual(result?.finishReason, 'tool_calls')
    })

    test('stops processing after [DONE]', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            '[DONE]',
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        strictEqual(result, undefined)
        strictEqual(reported.length, 0)
    })

    test('accepts a final [DONE] without a trailing newline', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const encoder = new TextEncoder()
        // No trailing newline: the [DONE] marker arrives in the EOF-residual
        // buffer and must be treated as a normal end, not as a missing
        // terminal event.
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoder.encode('data: [DONE]'))
                controller.close()
            },
        })
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        strictEqual(result, undefined)
        strictEqual(reported.length, 0)
    })

    test('throws when [DONE] arrives with invalid tool call arguments', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: '' } },
            { type: 'response.function_call_arguments.delta', output_index: 0, item_id: 'fc_1', name: 'read_file', delta: '{"filePath":' },
            { type: 'response.function_call_arguments.done', output_index: 0, item_id: 'fc_1', name: 'read_file' },
            '[DONE]',
        ])
        await rejects(api.processStreamingResponse(stream, progress, cts.token), /Invalid JSON for tool call/)
    })

    test('throws when a tool call has no call id', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        // The gateway omits output_item events, so no call id is ever set.
        const stream = makeSseStream([
            { type: 'response.function_call_arguments.delta', output_index: 0, item_id: 'fc_1', name: 'read_file', delta: '{"filePath":"/a.ts"}' },
            { type: 'response.function_call_arguments.done', output_index: 0, item_id: 'fc_1', name: 'read_file', arguments: '{"filePath":"/a.ts"}' },
            '[DONE]',
        ])
        await rejects(api.processStreamingResponse(stream, progress, cts.token), /Tool call missing id/)
    })

    test('throws when [DONE] arrives with incomplete tool calls', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        // Only deltas, no done event: the tool call never completed.
        const stream = makeSseStream([
            { type: 'response.function_call_arguments.delta', output_index: 0, item_id: 'fc_1', name: 'read_file', delta: '{"filePath":"/a.ts"}' },
            '[DONE]',
        ])
        await rejects(api.processStreamingResponse(stream, progress, cts.token), /Stream ended with incomplete tool calls/)
    })

    test('splits SSE lines across multiple read chunks', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const lines = [
            'data: ' + JSON.stringify({ type: 'response.output_text.delta', output_index: 0, item_id: 'msg_1', delta: 'Hello' }) + '\n',
            'data: ' + JSON.stringify({ type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } }) + '\n',
        ].join('')
        const mid = Math.floor(lines.length / 2)
        const stream = makeChunkedSseStream([lines.slice(0, mid), lines.slice(mid)])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        const textParts = reported.filter(p => p instanceof vscode.LanguageModelTextPart)
        strictEqual(textParts.length, 1)
        strictEqual(textParts[0].value, 'Hello')
        strictEqual(result?.finishReason, 'stop')
    })

    test('detects a reasoning loop and emits the redirect message', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        // 90 tokens of a repeating 3-word pattern: long enough to trigger the
        // loop check (500 chars) and the repetition detector (20+ words).
        const repeating = 'alpha beta gamma '.repeat(30)
        const stream = makeSseStream([
            { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, delta: repeating },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } },
        ])
        await api.processStreamingResponse(stream, progress, cts.token)
        const textParts = reported.filter((p): p is vscode.LanguageModelTextPart => p instanceof vscode.LanguageModelTextPart)
        strictEqual(textParts.some(p => p.value.includes('Detected repetitive output')), true)
    })

    test('flushes complete tool calls when [DONE] arrives', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: '' } },
            { type: 'response.function_call_arguments.delta', output_index: 0, item_id: 'fc_1', name: 'read_file', delta: '{"filePath":"a.ts"}' },
            { type: 'response.function_call_arguments.done', output_index: 0, item_id: 'fc_1', name: 'read_file', arguments: '{"filePath":"a.ts"}' },
            '[DONE]',
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        const toolCallParts = reported.filter((p): p is vscode.LanguageModelToolCallPart => p instanceof vscode.LanguageModelToolCallPart)
        strictEqual(toolCallParts.length, 1)
        // The [DONE] marker carries no finish reason; it is synthesized from
        // the flushed tool calls so pushToolCall can act on them.
        strictEqual(result?.finishReason, 'tool_calls')
    })

    test('throws on response.failed event', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.failed', response: { id: 'resp_1', error: { code: 'server_error' } } },
        ])
        await rejects(api.processStreamingResponse(stream, progress, cts.token), /Responses API failed/)
    })

    test('throws on error event', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'error', message: 'boom' },
        ])
        await rejects(api.processStreamingResponse(stream, progress, cts.token), /Responses API error event/)
    })

    test('does not duplicate text when a delta emits nothing before done', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.output_text.delta', output_index: 0, item_id: 'msg_1', delta: 'Hello' },
            { type: 'response.output_text.delta', output_index: 0, item_id: 'msg_1', delta: '' },
            { type: 'response.output_text.done', output_index: 0, item_id: 'msg_1', text: 'Hello' },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        const textParts = reported.filter(p => p instanceof vscode.LanguageModelTextPart)
        strictEqual(textParts.length, 1)
        strictEqual(result?.finishReason, 'stop')
    })

    test('emits refusal text from an object-shaped delta and not again on done', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            // Chat-completions style refusal delta forwarded by a gateway.
            { type: 'response.refusal.delta', output_index: 0, item_id: 'msg_1', delta: { refusal: 'I cannot help with that' } },
            { type: 'response.refusal.done', output_index: 0, item_id: 'msg_1', refusal: 'I cannot help with that' },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        const textParts = reported.filter(p => p instanceof vscode.LanguageModelTextPart)
        strictEqual(textParts.length, 1)
        strictEqual(textParts[0].value, 'I cannot help with that')
        strictEqual(result?.finishReason, 'stop')
    })

    test('emits refusal text from the done event when no delta was sent', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.refusal.done', output_index: 0, item_id: 'msg_1', refusal: 'I cannot help with that' },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        const textParts = reported.filter(p => p instanceof vscode.LanguageModelTextPart)
        strictEqual(textParts.length, 1)
        strictEqual(textParts[0].value, 'I cannot help with that')
        strictEqual(result?.finishReason, 'stop')
    })

    test('does not duplicate think blocks on the done event', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.output_text.delta', output_index: 0, item_id: 'msg_1', delta: '<think>my thought</think>' },
            { type: 'response.output_text.done', output_index: 0, item_id: 'msg_1', text: '<think>my thought</think>' },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        const thinkingParts = reported.filter(p => p instanceof vscode.LanguageModelThinkingPart)
        strictEqual(thinkingParts.length, 1)
        const textParts = reported.filter(p => p instanceof vscode.LanguageModelTextPart)
        strictEqual(textParts.some(p => p.value.includes('<think>')), false)
        strictEqual(result?.finishReason, 'stop')
    })

    test('continues an unclosed think block across chunks', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.output_text.delta', output_index: 0, item_id: 'msg_1', delta: '<think>part one' },
            { type: 'response.output_text.delta', output_index: 0, item_id: 'msg_1', delta: ' part two</think>after' },
            { type: 'response.output_text.done', output_index: 0, item_id: 'msg_1', text: '<think>part one part two</think>after' },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        const thinkingParts = reported.filter(p => p instanceof vscode.LanguageModelThinkingPart)
        strictEqual(thinkingParts.length, 2)
        strictEqual(thinkingParts.every(p => p.id === thinkingParts[0].id), true)
        strictEqual(thinkingParts.map(p => Array.isArray(p.value) ? p.value.join('') : p.value).join(''), 'part one part two')
        const textParts = reported.filter(p => p instanceof vscode.LanguageModelTextPart)
        strictEqual(textParts.some(p => p.value === 'after'), true)
        strictEqual(textParts.some(p => p.value.includes('<')), false)
        strictEqual(result?.finishReason, 'stop')
    })

    test('stops reading when cancelled', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const encoder = new TextEncoder()
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"Hello"}\n'))
            },
        })
        const promise = api.processStreamingResponse(stream, progress, cts.token)
        setTimeout(() => cts.cancel(), 50)
        const result = await promise
        strictEqual(result, undefined)
    })

    test('reports usage from the completed event', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 }, output_tokens_details: { reasoning_tokens: 4 } } } },
        ])
        await api.processStreamingResponse(stream, progress, cts.token)
        const usageParts = reported.filter((p): p is vscode.LanguageModelDataPart => p instanceof vscode.LanguageModelDataPart && p.mimeType === 'usage')
        strictEqual(usageParts.length, 1)
        const usage = JSON.parse(new TextDecoder().decode(usageParts[0].data)) as Record<string, unknown>
        strictEqual(usage['prompt_tokens'], 10)
        strictEqual(usage['completion_tokens'], 5)
        strictEqual(usage['total_tokens'], 15)
        const details = usage['prompt_tokens_details'] as Record<string, unknown>
        strictEqual(details['cached_tokens'], 3)
        strictEqual(details['cache_creation_input_tokens'], 2)
        const completionDetails = usage['completion_tokens_details'] as Record<string, unknown>
        strictEqual(completionDetails['reasoning_tokens'], 4)
    })

    test('emits fallback text when the model stops without emitting text', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        strictEqual(result?.finishReason, 'stop')
        const fallbackParts = reported.filter((p): p is vscode.LanguageModelTextPart2 =>
            p instanceof vscode.LanguageModelTextPart2 && p.value.includes('The model stopped before emitting text'))
        strictEqual(fallbackParts.length, 1)
    })

    test('does not emit fallback text when text was emitted', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.output_text.delta', output_index: 0, item_id: 'msg_1', delta: 'Hello' },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        strictEqual(result?.finishReason, 'stop')
        const fallbackParts = reported.filter((p): p is vscode.LanguageModelTextPart2 =>
            p instanceof vscode.LanguageModelTextPart2 && p.value.includes('The model stopped before emitting text'))
        strictEqual(fallbackParts.length, 0)
    })

    test('treats response.incomplete as a normal length finish', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.incomplete', response: { id: 'resp_1', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        strictEqual(result?.finishReason, 'length')
    })

    test('treats response.incomplete content_filter as a content_filter finish', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.incomplete', response: { id: 'resp_1', status: 'incomplete', incomplete_details: { reason: 'content_filter' } } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        strictEqual(result?.finishReason, 'content_filter')
    })

    test('postAndGetBody throws on non-2xx responses', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const originalFetch = globalThis.fetch
        globalThis.fetch = (() => Promise.resolve(new Response('boom', { status: 500, statusText: 'Internal Server Error' }))) as typeof fetch
        try {
            await rejects(
                api.postAndGetBody('https://example.com', {}, {}, new AbortController().signal, 'test'),
                /test error: \[500\] Internal Server Error/
            )
        } finally {
            globalThis.fetch = originalFetch
        }
    })

    test('postAndGetBody throws when the response has no body', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const originalFetch = globalThis.fetch
        globalThis.fetch = (() => Promise.resolve(new Response(null, { status: 200 }))) as typeof fetch
        try {
            await rejects(
                api.postAndGetBody('https://example.com', {}, {}, new AbortController().signal, 'test'),
                /No response body from test/
            )
        } finally {
            globalThis.fetch = originalFetch
        }
    })

    test('emits a tool call once with the done-event full arguments', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'grep', arguments: '' } },
            { type: 'response.function_call_arguments.delta', output_index: 0, item_id: 'fc_1', name: 'grep', delta: '{"pattern":"foo"}' },
            { type: 'response.function_call_arguments.done', output_index: 0, item_id: 'fc_1', name: 'grep', arguments: '{"pattern":"foo","count":3}' },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'grep', arguments: '{"pattern":"foo","count":3}' }] } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        const toolCallParts = reported.filter((p): p is vscode.LanguageModelToolCallPart => p instanceof vscode.LanguageModelToolCallPart)
        strictEqual(toolCallParts.length, 1)
        strictEqual(toolCallParts[0].callId, 'call_1')
        deepStrictEqual(toolCallParts[0].input, { pattern: 'foo', count: 3 })
        strictEqual(result?.finishReason, 'tool_calls')
    })

    test('emits all deltas of the same reasoning summary', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        // Multiple deltas arrive for the same output_index:summary_index.
        const stream = makeSseStream([
            { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, delta: 'The ' },
            { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, delta: 'user ' },
            { type: 'response.reasoning_summary_text.delta', output_index: 0, summary_index: 0, delta: 'asked' },
            { type: 'response.reasoning_summary_text.done', output_index: 0, summary_index: 0, text: 'The user asked' },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } },
        ])
        await api.processStreamingResponse(stream, progress, cts.token)
        const thinkingParts = reported.filter(p => p instanceof vscode.LanguageModelThinkingPart)
        strictEqual(thinkingParts.length, 3)
        strictEqual(thinkingParts.map(p => Array.isArray(p.value) ? p.value.join('') : p.value).join(''), 'The user asked')
    })

    test('restores message text delivered only in the completed event', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [{ type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Hello from completed', annotations: [] }] }] } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        const textParts = reported.filter(p => p instanceof vscode.LanguageModelTextPart)
        strictEqual(textParts.length, 1)
        strictEqual(textParts[0].value, 'Hello from completed')
        strictEqual(result?.finishReason, 'stop')
    })

    test('emits a tool call delivered only in the completed event', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'grep', arguments: '{"pattern":"foo"}' }] } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        const toolCallParts = reported.filter((p): p is vscode.LanguageModelToolCallPart => p instanceof vscode.LanguageModelToolCallPart)
        strictEqual(toolCallParts.length, 1)
        strictEqual(toolCallParts[0].callId, 'call_1')
        deepStrictEqual(toolCallParts[0].input, { pattern: 'foo' })
        strictEqual(result?.finishReason, 'tool_calls')
    })

    test('does not duplicate text when deltas already streamed it', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.output_text.delta', output_index: 0, item_id: 'msg_1', delta: 'Hello' },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [{ type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Hello', annotations: [] }] }] } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        const textParts = reported.filter(p => p instanceof vscode.LanguageModelTextPart)
        strictEqual(textParts.length, 1)
        strictEqual(textParts[0].value, 'Hello')
        strictEqual(result?.finishReason, 'stop')
    })

    test('classifies a completed response without output as tool_calls when tool calls were flushed', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: '{"filePath":"/a.ts"}' } },
            // The completed payload omits the output array entirely.
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed' } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        strictEqual(result?.finishReason, 'tool_calls')
        // No fallback "stopped before emitting text" text is emitted.
        const fallbackParts = reported.filter((p): p is vscode.LanguageModelTextPart2 =>
            p instanceof vscode.LanguageModelTextPart2 && p.value.includes('The model stopped before emitting text'))
        strictEqual(fallbackParts.length, 0)
    })

    test('emits multiple tool calls with distinct ids', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: '{"filePath":"/a.ts"}' } },
            { type: 'response.output_item.done', output_index: 1, item: { type: 'function_call', id: 'fc_2', call_id: 'call_2', name: 'grep', arguments: '{"pattern":"foo"}' } },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        const toolCallParts = reported.filter((p): p is vscode.LanguageModelToolCallPart => p instanceof vscode.LanguageModelToolCallPart)
        strictEqual(toolCallParts.length, 2)
        strictEqual(toolCallParts[0].callId, 'call_1')
        // adjustReadFileParameters extends read_file to 1500 lines by default.
        deepStrictEqual(toolCallParts[0].input, { filePath: '/a.ts', endLine: 1501 })
        strictEqual(toolCallParts[1].callId, 'call_2')
        deepStrictEqual(toolCallParts[1].input, { pattern: 'foo' })
        strictEqual(result?.finishReason, 'tool_calls')
    })

    test('ignores unknown event types without throwing', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            // A gateway-specific event type must not break the stream.
            { type: 'custom.gateway_event', data: 'x' },
            { type: 'response.output_text.delta', output_index: 0, item_id: 'msg_1', delta: 'Hello' },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        const textParts = reported.filter(p => p instanceof vscode.LanguageModelTextPart)
        strictEqual(textParts.length, 1)
        strictEqual(textParts[0].value, 'Hello')
        strictEqual(result?.finishReason, 'stop')
    })

    test('throws when the stream ends without a terminal event', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        // Only a delta, then EOF: no completed/incomplete/[DONE].
        const stream = makeSseStream([
            { type: 'response.output_text.delta', output_index: 0, item_id: 'msg_1', delta: 'Hello' },
        ])
        await rejects(
            api.processStreamingResponse(stream, progress, cts.token),
            (err: unknown) => err instanceof ResponsesStreamError && err.code === 'no_terminal_event'
        )
    })

    test('cancels the reader when the stream processing throws', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        let cancelCount = 0
        const encoder = new TextEncoder()
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoder.encode('data: {"type":"response.failed","response":{"id":"resp_1","error":{"code":"server_error"}}}\n'))
            },
            cancel() {
                cancelCount++
            },
        })
        await rejects(api.processStreamingResponse(stream, progress, cts.token), /Responses API failed/)
        strictEqual(cancelCount, 1)
    })

    test('does not fail when [DONE] follows response.incomplete with buffered tool calls', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        // The tool call never completed; response.incomplete must discard it so
        // the following [DONE] does not report it as incomplete.
        const stream = makeSseStream([
            { type: 'response.function_call_arguments.delta', output_index: 0, item_id: 'fc_1', name: 'read_file', delta: '{"filePath":"/a.ts"}' },
            { type: 'response.incomplete', response: { id: 'resp_1', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } },
            '[DONE]',
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        strictEqual(result?.finishReason, 'length')
        const toolCallParts = reported.filter((p): p is vscode.LanguageModelToolCallPart => p instanceof vscode.LanguageModelToolCallPart)
        strictEqual(toolCallParts.length, 0)
    })

    test('ignores a rogue response.completed after response.incomplete', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        // A misbehaving gateway may follow response.incomplete with a
        // response.completed; the finish reason must stay 'length' and the
        // cut-off tool call from the completed payload must not be re-emitted.
        const stream = makeSseStream([
            { type: 'response.function_call_arguments.delta', output_index: 0, item_id: 'fc_1', name: 'read_file', delta: '{"filePath":"/a.ts"}' },
            { type: 'response.incomplete', response: { id: 'resp_1', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: '{"filePath":"/a.ts"}' }] } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        strictEqual(result?.finishReason, 'length')
        const toolCallParts = reported.filter((p): p is vscode.LanguageModelToolCallPart => p instanceof vscode.LanguageModelToolCallPart)
        strictEqual(toolCallParts.length, 0)
    })

    test('does not emit text after response.incomplete', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        // A rogue delta after the terminal event must not be emitted.
        const stream = makeSseStream([
            { type: 'response.incomplete', response: { id: 'resp_1', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } },
            { type: 'response.output_text.delta', output_index: 0, item_id: 'msg_1', delta: 'rogue text' },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        strictEqual(result?.finishReason, 'length')
        const textParts = reported.filter(p => p instanceof vscode.LanguageModelTextPart)
        strictEqual(textParts.some(p => p.value.includes('rogue')), false)
    })

    test('resolves when the stream never closes after a terminal event', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const encoder = new TextEncoder()
        // The stream stays open forever; the terminal event must end
        // processing without waiting for EOF.
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoder.encode('data: ' + JSON.stringify({ type: 'response.incomplete', response: { id: 'resp_1', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } }) + '\n'))
            },
        })
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        strictEqual(result?.finishReason, 'length')
    })

    test('restores a complete tool call from the completed payload over partial deltas', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        // The delta stream cuts off mid-JSON; the completed payload carries
        // the complete function call and must win over the partial buffer.
        const stream = makeSseStream([
            { type: 'response.function_call_arguments.delta', output_index: 0, item_id: 'fc_1', name: 'read_file', delta: '{"filePath":' },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: '{"filePath":"/a.ts"}' }] } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        const toolCallParts = reported.filter((p): p is vscode.LanguageModelToolCallPart => p instanceof vscode.LanguageModelToolCallPart)
        strictEqual(toolCallParts.length, 1)
        strictEqual(toolCallParts[0].callId, 'call_1')
        deepStrictEqual(toolCallParts[0].input, { filePath: '/a.ts', endLine: 1501 })
        strictEqual(result?.finishReason, 'tool_calls')
    })

    test('times out when the stream delivers no data', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo(), { inactivityTimeoutMs: 50 })
        const { progress } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        let cancelCount = 0
        // The stream never enqueues data and never closes; the inactivity
        // timeout must end the request with an error and cancel the reader.
        const stream = new ReadableStream<Uint8Array>({
            cancel() {
                cancelCount++
            },
        })
        await rejects(
            api.processStreamingResponse(stream, progress, cts.token),
            (err: unknown) => err instanceof ResponsesStreamError && err.code === 'inactivity_timeout'
        )
        strictEqual(cancelCount, 1)
    })

    test('does not time out while chunks keep arriving', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo(), { inactivityTimeoutMs: 500 })
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const encoder = new TextEncoder()
        // The second chunk arrives 100ms after the first; the 500ms timeout
        // must be re-armed per read, so the gap between chunks is fine.
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoder.encode('data: ' + JSON.stringify({ type: 'response.output_text.delta', output_index: 0, item_id: 'msg_1', delta: 'Hello' }) + '\n'))
                setTimeout(() => {
                    controller.enqueue(encoder.encode('data: ' + JSON.stringify({ type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [] } }) + '\n'))
                    controller.close()
                }, 100)
            },
        })
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        strictEqual(result?.finishReason, 'stop')
        const textParts = reported.filter(p => p instanceof vscode.LanguageModelTextPart)
        strictEqual(textParts.length, 1)
        strictEqual(textParts[0].value, 'Hello')
    })

    test('times out when the streaming phase is exceeded', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo(), { streamTimeoutMs: 50 })
        const { progress } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const encoder = new TextEncoder()
        // Chunks keep arriving (so the inactivity timer never fires) but no
        // terminal event ever comes; the total timeout must end the request.
        let timer: ReturnType<typeof setInterval> | undefined
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                timer = setInterval(() => {
                    controller.enqueue(encoder.encode('data: ' + JSON.stringify({ type: 'response.output_text.delta', output_index: 0, item_id: 'msg_1', delta: 'x' }) + '\n'))
                }, 10)
            },
            cancel() {
                if (timer !== undefined) {
                    clearInterval(timer)
                }
            },
        })
        try {
            await rejects(
                api.processStreamingResponse(stream, progress, cts.token),
                (err: unknown) => err instanceof ResponsesStreamError && err.code === 'stream_timeout'
            )
        } finally {
            if (timer !== undefined) {
                clearInterval(timer)
            }
        }
    })

    test('rejects invalid timeout values', () => {
        for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
            throws(() => new OpenaiResponsesApi(makeModelInfo(), { inactivityTimeoutMs: bad }), TypeError)
            throws(() => new OpenaiResponsesApi(makeModelInfo(), { streamTimeoutMs: bad }), TypeError)
        }
    })
})

suite('encryptedreasoning.decode', () => {
    test('rejects malformed marker payloads', () => {
        const payloads = [
            // Not base64url at all.
            'model\\able-enc:%%%',
            // Valid base64url but not JSON.
            'model\\able-enc:' + Buffer.from('hello', 'utf8').toString('base64url'),
            // JSON with a non-matching schema.
            'model\\able-enc:' + Buffer.from(JSON.stringify({ id: 1, content: 2 }), 'utf8').toString('base64url'),
            // Empty payload.
            'model\\able-enc:',
        ]
        for (const payload of payloads) {
            const part = new vscode.LanguageModelDataPart(new TextEncoder().encode(payload), 'stateful_marker')
            strictEqual(decodeEncryptedReasoningPart(part, RESPONSES_MODEL_ID), undefined)
        }
    })

    test('rejects non-stateful-marker mime types and missing separators', () => {
        const validMarker = 'model\\able-enc:' + Buffer.from(JSON.stringify({ id: 'rs_1', content: 'x' }), 'utf8').toString('base64url')
        const noSeparator = new vscode.LanguageModelDataPart(new TextEncoder().encode('able-enc:xxx'), 'stateful_marker')
        strictEqual(decodeEncryptedReasoningPart(noSeparator, RESPONSES_MODEL_ID), undefined)
        const wrongMime = new vscode.LanguageModelDataPart(new TextEncoder().encode(validMarker), 'application/x-unknown')
        strictEqual(decodeEncryptedReasoningPart(wrongMime, RESPONSES_MODEL_ID), undefined)
        // A marker from a different model must be ignored.
        const otherModel = new vscode.LanguageModelDataPart(new TextEncoder().encode('other-model\\able-enc:' + Buffer.from(JSON.stringify({ id: 'rs_1', content: 'x' }), 'utf8').toString('base64url')), 'stateful_marker')
        strictEqual(decodeEncryptedReasoningPart(otherModel, RESPONSES_MODEL_ID), undefined)
        strictEqual(decodeEncryptedReasoningPart(otherModel, 'other-model')?.id, 'rs_1')
    })

    test('marker payload contains no backslash after the separator', () => {
        const part = encodeEncryptedReasoningPart(RESPONSES_MODEL_ID, { id: 'rs_abc', content: 'enc-blob' })
        const decoded = new TextDecoder().decode(part.data)
        const marker = decoded.slice(decoded.indexOf('\\') + 1)
        strictEqual(marker.includes('\\'), false)
    })
})
