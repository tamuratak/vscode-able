import { deepStrictEqual, rejects, strictEqual } from 'node:assert'
import * as vscode from 'vscode'
import { OpenaiResponsesApi } from '../../../src/chatprovider/opencodegochatprovider/openai/openaiResponsesApi.js'
import { getBuiltInModelConfig, getBuiltInModelInfos } from '../../../src/chatprovider/opencodegochatprovider/models.js'
import type { OpenCodeGoModelItem } from '../../../src/chatprovider/opencodegochatprovider/types.js'

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
})

suite('OpenaiResponsesApi.processStreamingResponse', () => {
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
            { type: 'response.function_call_arguments.delta', output_index: 0, call_id: 'call_1', name: 'read_file', delta: '{"filePath":"/a.ts"}' },
            { type: 'response.function_call_arguments.done', output_index: 0, call_id: 'call_1', name: 'read_file', arguments: '{"filePath":"/a.ts"}' },
            { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: '{"filePath":"/a.ts"}' } },
            { type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: '{"filePath":"/a.ts"}' } },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'read_file', arguments: '{"filePath":"/a.ts"}' }] } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        const toolCallParts = reported.filter(p => p instanceof vscode.LanguageModelToolCallPart)
        strictEqual(toolCallParts.length, 1)
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

    test('throws when [DONE] arrives with invalid tool call arguments', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.function_call_arguments.delta', output_index: 0, call_id: 'call_1', name: 'read_file', delta: '{"filePath":' },
            { type: 'response.function_call_arguments.done', output_index: 0, call_id: 'call_1', name: 'read_file' },
            '[DONE]',
        ])
        await rejects(api.processStreamingResponse(stream, progress, cts.token), /Invalid JSON for tool call/)
    })

    test('flushes complete tool calls when [DONE] arrives', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.function_call_arguments.delta', output_index: 0, call_id: 'call_1', name: 'read_file', delta: '{"filePath":"a.ts"}' },
            { type: 'response.function_call_arguments.done', output_index: 0, call_id: 'call_1', name: 'read_file', arguments: '{"filePath":"a.ts"}' },
            '[DONE]',
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        const toolCallParts = reported.filter((p): p is vscode.LanguageModelToolCallPart => p instanceof vscode.LanguageModelToolCallPart)
        strictEqual(toolCallParts.length, 1)
        strictEqual(result, undefined)
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
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 } } } },
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

    test('emits a tool call once with the done-event full arguments', async () => {
        const api = new OpenaiResponsesApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { type: 'response.function_call_arguments.delta', output_index: 0, call_id: 'call_1', name: 'grep', delta: '{"pattern":"foo"}' },
            { type: 'response.function_call_arguments.done', output_index: 0, call_id: 'call_1', name: 'grep', arguments: '{"pattern":"foo","count":3}' },
            { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [{ type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'grep', arguments: '{"pattern":"foo","count":3}' }] } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        const toolCallParts = reported.filter((p): p is vscode.LanguageModelToolCallPart => p instanceof vscode.LanguageModelToolCallPart)
        strictEqual(toolCallParts.length, 1)
        deepStrictEqual(toolCallParts[0].input, { pattern: 'foo', count: 3 })
        strictEqual(result?.finishReason, 'tool_calls')
    })
})
