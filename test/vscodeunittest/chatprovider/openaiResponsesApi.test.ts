import { strictEqual } from 'node:assert'
import * as vscode from 'vscode'
import { OpenaiResponsesApi } from '../../../src/chatprovider/opencodegochatprovider/openai/openaiResponsesApi.js'
import { getBuiltInModelInfos } from '../../../src/chatprovider/opencodegochatprovider/models.js'

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
})
