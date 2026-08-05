import { strictEqual } from 'node:assert'
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
} from '../../../src/chatprovider/opencodegochatprovider/openai/responsesEventUtils.js'

suite('responsesEventUtils', () => {
    test('coerceText passes through plain strings', () => {
        strictEqual(coerceText('hello'), 'hello')
        strictEqual(coerceText(''), '')
    })

    test('coerceText reads text-ish fields from objects', () => {
        strictEqual(coerceText({ text: 'a' }), 'a')
        strictEqual(coerceText({ thinking: 'b' }), 'b')
        strictEqual(coerceText({ reasoning: 'c' }), 'c')
        strictEqual(coerceText({ summary: 'd' }), 'd')
        strictEqual(coerceText({ value: 'e' }), 'e')
    })

    test('coerceText returns empty for unsupported values', () => {
        strictEqual(coerceText(null), '')
        strictEqual(coerceText(42), '')
        strictEqual(coerceText([]), '')
        strictEqual(coerceText({ text: 1 }), '')
        strictEqual(coerceText({ other: 'x' }), '')
    })

    test('summaryTextOf and refusalTextOf extract their fields', () => {
        strictEqual(summaryTextOf({ type: 'summary_text', text: 'x' }), 'x')
        strictEqual(summaryTextOf({ text: 3 }), '')
        strictEqual(summaryTextOf({ noText: 'x' }), '')
        strictEqual(summaryTextOf('nope'), '')
        strictEqual(refusalTextOf({ refusal: 'no' }), 'no')
        strictEqual(refusalTextOf({ refusal: 5 }), '')
        strictEqual(refusalTextOf({}), '')
    })

    test('looksLikeReasoningConfigValue recognizes configuration values', () => {
        for (const v of ['high', 'MEDIUM', 'Low ', 'minimal', 'auto', 'none', 'detailed', 'concise']) {
            strictEqual(looksLikeReasoningConfigValue(v), true)
        }
        strictEqual(looksLikeReasoningConfigValue('hello'), false)
        strictEqual(looksLikeReasoningConfigValue(''), false)
    })

    test('extractOutputText joins output_text parts only', () => {
        const item = {
            content: [
                { type: 'output_text', text: 'a' },
                { type: 'input_text', text: 'b' },
                { type: 'output_text', text: 'c' },
            ],
        }
        strictEqual(extractOutputText(item), 'ac')
        strictEqual(extractOutputText({ content: 'x' }), '')
        strictEqual(extractOutputText({}), '')
    })

    test('getCallIdFromEvent prefers call_id over callId', () => {
        strictEqual(getCallIdFromEvent({ call_id: 'call_1' }), 'call_1')
        strictEqual(getCallIdFromEvent({ callId: 'call_2' }), 'call_2')
        strictEqual(getCallIdFromEvent({ call_id: 'call_3', callId: 'call_4' }), 'call_3')
        strictEqual(getCallIdFromEvent({ item_id: 'fc_1' }), '')
    })

    test('synthesizeFinishReason classifies nested and flat completed events', () => {
        const indices = new Set<number>()
        strictEqual(synthesizeFinishReason({ response: { status: 'completed', output: [{ type: 'function_call', call_id: 'call_1' }] } }, indices), 'tool_calls')
        strictEqual(synthesizeFinishReason({ response: { status: 'completed', output: [] } }, indices), 'stop')
        strictEqual(synthesizeFinishReason({ response: { status: 'completed' } }, indices), 'stop')
        strictEqual(synthesizeFinishReason({ response: { status: 'incomplete' } }, indices), undefined)
        // Flat events without a nested response fall back to the flush state.
        strictEqual(synthesizeFinishReason({ status: 'completed' }, indices), 'stop')
        strictEqual(synthesizeFinishReason({ status: 'completed' }, new Set([0])), 'tool_calls')
        strictEqual(synthesizeFinishReason({}, indices), undefined)
    })

    test('synthesizeIncompleteFinishReason maps content_filter and defaults to length', () => {
        strictEqual(synthesizeIncompleteFinishReason({ reason: 'content_filter' }), 'content_filter')
        strictEqual(synthesizeIncompleteFinishReason({ reason: 'max_output_tokens' }), 'length')
        strictEqual(synthesizeIncompleteFinishReason(undefined), 'length')
        strictEqual(synthesizeIncompleteFinishReason('garbage'), 'length')
    })

    test('extractUsage maps the responses token breakdown', () => {
        const usage = extractUsage({
            usage: {
                input_tokens: 10,
                output_tokens: 5,
                total_tokens: 15,
                input_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 },
                output_tokens_details: { reasoning_tokens: 4 },
            },
        })
        strictEqual(usage?.prompt_tokens, 10)
        strictEqual(usage?.completion_tokens, 5)
        strictEqual(usage?.total_tokens, 15)
        strictEqual(usage?.prompt_tokens_details.cached_tokens, 3)
        strictEqual(usage?.prompt_tokens_details.cache_creation_input_tokens, 2)
        strictEqual(usage?.completion_tokens_details?.reasoning_tokens, 4)
    })

    test('extractUsage also reads usage nested in the response object', () => {
        const usage = extractUsage({ response: { usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } } })
        strictEqual(usage?.total_tokens, 3)
    })

    test('extractUsage returns undefined when usage is absent', () => {
        strictEqual(extractUsage({}), undefined)
        strictEqual(extractUsage({ usage: 'x' }), undefined)
    })
})
