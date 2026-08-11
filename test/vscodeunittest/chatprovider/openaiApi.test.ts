import { strictEqual, rejects } from 'node:assert'
import * as vscode from 'vscode'
import { OpenaiApi } from '../../../src/chatprovider/opencodegochatprovider/openai/openaiApi.js'
import { getBuiltInModelInfos } from '../../../src/chatprovider/opencodegochatprovider/models.js'

const CHAT_COMPLETIONS_MODEL_ID = 'deepseek-v4-flash'

function makeModelInfo(): vscode.LanguageModelChatInformation {
    const info = getBuiltInModelInfos().find(m => m.id === CHAT_COMPLETIONS_MODEL_ID)
    if (!info) {
        throw new Error(`Model not found: ${CHAT_COMPLETIONS_MODEL_ID}`)
    }
    return info
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

/** SSE stream whose final event has no trailing newline (gateway quirk). */
function makeSseStreamNoTrailingNewline(events: (string | Record<string, unknown>)[]): ReadableStream<Uint8Array> {
    const lines = events
        .map(e => typeof e === 'string' ? `data: ${e}` : `data: ${JSON.stringify(e)}`)
        .join('\n')
    const encoder = new TextEncoder()
    return new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(encoder.encode(lines))
            controller.close()
        },
    })
}

suite('OpenaiApi.processStreamingResponse', () => {
    test('emits text and finish reason when the final chunk has no trailing newline', async () => {
        const api = new OpenaiApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStreamNoTrailingNewline([
            { choices: [{ delta: { content: 'Hello' }, finish_reason: null }] },
            { choices: [{ delta: {}, finish_reason: 'stop' }] },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        strictEqual(result?.finishReason, 'stop')
        const textParts = reported.filter(p => p instanceof vscode.LanguageModelTextPart)
        strictEqual(textParts.length, 1)
        strictEqual(textParts[0].value, 'Hello')
    })

    test('accepts a final [DONE] without a trailing newline', async () => {
        const api = new OpenaiApi(makeModelInfo())
        const { progress } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const encoder = new TextEncoder()
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoder.encode('data: [DONE]'))
                controller.close()
            },
        })
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        strictEqual(result, undefined)
    })

    test('captures usage from a final chunk without a trailing newline', async () => {
        const api = new OpenaiApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStreamNoTrailingNewline([
            { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        strictEqual(result?.finishReason, 'stop')
        const usageParts = reported.filter((p): p is vscode.LanguageModelDataPart => p instanceof vscode.LanguageModelDataPart && p.mimeType === 'usage')
        strictEqual(usageParts.length, 1)
        const usage = JSON.parse(new TextDecoder().decode(usageParts[0].data)) as Record<string, unknown>
        strictEqual(usage['total_tokens'], 15)
    })

    test('handles a finish reason chunk split across a read boundary', async () => {
        const api = new OpenaiApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const encoder = new TextEncoder()
        const head = 'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n'
        const tail = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n'
        const mid = Math.floor(tail.length / 2)
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoder.encode(head + tail.slice(0, mid)))
                controller.enqueue(encoder.encode(tail.slice(mid)))
                controller.close()
            },
        })
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        strictEqual(result?.finishReason, 'stop')
        const textParts = reported.filter(p => p instanceof vscode.LanguageModelTextPart)
        strictEqual(textParts.length, 1)
        strictEqual(textParts[0].value, 'Hello')
    })

    test('processes a stream terminated with a trailing newline as before', async () => {
        const api = new OpenaiApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const stream = makeSseStream([
            { choices: [{ delta: { content: 'Hello' }, finish_reason: null }] },
            { choices: [{ delta: {}, finish_reason: 'stop' }] },
        ])
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        strictEqual(result?.finishReason, 'stop')
        const textParts = reported.filter(p => p instanceof vscode.LanguageModelTextPart)
        strictEqual(textParts.length, 1)
        strictEqual(textParts[0].value, 'Hello')
    })

    test('throws when a final [DONE] without a trailing newline arrives with incomplete tool calls', async () => {
        const api = new OpenaiApi(makeModelInfo())
        const { progress } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const encoder = new TextEncoder()
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoder.encode('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{"filePath":"/a.ts"}' } }] }, finish_reason: null }] }) + '\n'))
                controller.enqueue(encoder.encode('data: [DONE]'))
                controller.close()
            },
        })
        await rejects(api.processStreamingResponse(stream, progress, cts.token), /Stream ended with incomplete tool calls/)
    })

    test('does not hang when the stream never closes after [DONE]', async () => {
        const api = new OpenaiApi(makeModelInfo())
        const { progress } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const encoder = new TextEncoder()
        // The stream stays open forever; [DONE] must end processing without
        // waiting for EOF.
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(encoder.encode('data: [DONE]\n'))
            },
        })
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        strictEqual(result, undefined)
    })

    test('returns cleanly when cancelled during an open stream', async () => {
        const api = new OpenaiApi(makeModelInfo())
        const { progress } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        // The stream never enqueues data and never closes; the pending read is
        // cancelled via the cancellation callback and must resolve cleanly.
        const stream = new ReadableStream<Uint8Array>({})
        const promise = api.processStreamingResponse(stream, progress, cts.token)
        setTimeout(() => cts.cancel(), 50)
        const result = await promise
        strictEqual(result, undefined)
    })

    test('decodes a multi-byte character split across read chunks', async () => {
        const api = new OpenaiApi(makeModelInfo())
        const { progress, reported } = createMockProgress()
        const cts = new vscode.CancellationTokenSource()
        const encoder = new TextEncoder()
        // 'こ' is 3 UTF-8 bytes (E3 81 93); split it across two chunks so the
        // decoder must hold the partial sequence until the next chunk arrives.
        const head = encoder.encode('data: {"choices":[{"delta":{"content":"')
        const tail = encoder.encode('んにちは"},"finish_reason":null}]}\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n')
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array([...head, 0xE3]))
                controller.enqueue(new Uint8Array([0x81, 0x93, ...tail]))
                controller.close()
            },
        })
        const result = await api.processStreamingResponse(stream, progress, cts.token)
        strictEqual(result?.finishReason, 'stop')
        const textParts = reported.filter(p => p instanceof vscode.LanguageModelTextPart)
        strictEqual(textParts.length, 1)
        strictEqual(textParts[0].value, 'こんにちは')
    })
})
