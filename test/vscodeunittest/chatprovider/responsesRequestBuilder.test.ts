import { deepStrictEqual, strictEqual } from 'node:assert'
import * as vscode from 'vscode'
import { ResponsesRequestBuilder } from '../../../src/chatprovider/opencodegochatprovider/openai/responsesRequestBuilder.js'
import { getBuiltInModelConfig } from '../../../src/chatprovider/opencodegochatprovider/models.js'
import type { OpenCodeGoModelItem } from '../../../src/chatprovider/opencodegochatprovider/types.js'

const RESPONSES_MODEL_ID = 'gpt-5.6-luna'

function makeModel(overrides: Partial<OpenCodeGoModelItem>): OpenCodeGoModelItem {
    const base = getBuiltInModelConfig(RESPONSES_MODEL_ID)
    if (!base) {
        throw new Error(`Model not found: ${RESPONSES_MODEL_ID}`)
    }
    return { ...base, ...overrides }
}

suite('ResponsesRequestBuilder', () => {
    test('mutates and returns the passed body object', () => {
        const builder = new ResponsesRequestBuilder()
        const rb = { model: 'm', input: [] }
        const result = builder.prepareRequestBody(rb, 'instructions', makeModel({ enable_thinking: true }), undefined)
        strictEqual(result, rb)
        strictEqual(rb['instructions'], 'instructions')
    })

    test('sets reasoning effort when thinking is enabled', () => {
        const builder = new ResponsesRequestBuilder()
        const rb = builder.prepareRequestBody({}, undefined, makeModel({ enable_thinking: true, reasoning_effort: 'high' }), undefined)
        deepStrictEqual(rb['reasoning'], { effort: 'high' })
    })

    test('disables reasoning when thinking is not enabled', () => {
        const builder = new ResponsesRequestBuilder()
        const rb = builder.prepareRequestBody({}, undefined, makeModel({ enable_thinking: false }), undefined)
        deepStrictEqual(rb['reasoning'], { effort: 'none' })
    })

    test('deep-merges extra reasoning config into the reasoning object', () => {
        const builder = new ResponsesRequestBuilder()
        const rb = builder.prepareRequestBody(
            {},
            undefined,
            makeModel({ enable_thinking: true, reasoning_effort: 'low', extra: { reasoning: { summary: 'detailed' } } }),
            undefined
        )
        deepStrictEqual(rb['reasoning'], { effort: 'low', summary: 'detailed' })
    })

    test('merges include entries without duplicates', () => {
        const builder = new ResponsesRequestBuilder()
        const rb = builder.prepareRequestBody(
            { include: ['item_id', 'reasoning.encrypted_content'] },
            undefined,
            makeModel({ enable_thinking: true }),
            undefined
        )
        deepStrictEqual(rb['include'], ['item_id', 'reasoning.encrypted_content'])
    })

    test('does not request encrypted reasoning content when thinking is disabled', () => {
        const builder = new ResponsesRequestBuilder()
        const rb = builder.prepareRequestBody({}, undefined, makeModel({ enable_thinking: false }), undefined)
        strictEqual(rb['include'], undefined)
    })

    test('does not request encrypted reasoning content when reasoning is not forwarded', () => {
        const builder = new ResponsesRequestBuilder()
        const rb = builder.prepareRequestBody(
            {},
            undefined,
            makeModel({ enable_thinking: true, include_reasoning_in_request: false }),
            undefined
        )
        strictEqual(rb['include'], undefined)
    })

    test('converts tool definitions and tool mode', () => {
        const builder = new ResponsesRequestBuilder()
        const options: vscode.ProvideLanguageModelChatResponseOptions = {
            toolMode: vscode.LanguageModelChatToolMode.Auto,
            tools: [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: {} } }],
            modelOptions: { toolMode: 'required' },
            requestInitiator: 'test',
        }
        const rb = builder.prepareRequestBody({}, undefined, undefined, options)
        strictEqual(rb['tool_choice'], 'required')
        const tools = rb['tools'] as Record<string, unknown>[] | undefined
        strictEqual(tools?.length, 1)
        strictEqual(tools?.[0]?.['name'], 'read_file')
    })
})
