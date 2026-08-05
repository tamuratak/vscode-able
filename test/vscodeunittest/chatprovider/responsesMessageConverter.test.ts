import { strictEqual } from 'node:assert'
import * as vscode from 'vscode'
import { ResponsesMessageConverter } from '../../../src/chatprovider/opencodegochatprovider/openai/responsesMessageConverter.js'
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

suite('ResponsesMessageConverter', () => {
    test('accumulates system messages into systemContent', () => {
        const converter = new ResponsesMessageConverter(makeModelInfo())
        converter.convertMessages(
            [
                makeTextMsg(vscode.LanguageModelChatMessageRole.System, 'system one'),
                makeTextMsg(vscode.LanguageModelChatMessageRole.System, 'system two'),
                makeTextMsg(vscode.LanguageModelChatMessageRole.User, 'hello'),
            ],
            { includeReasoningInRequest: true }
        )
        strictEqual(converter.systemContent, 'system one\n\nsystem two')
    })

    test('resets systemContent between convertMessages calls', () => {
        const converter = new ResponsesMessageConverter(makeModelInfo())
        converter.convertMessages(
            [
                makeTextMsg(vscode.LanguageModelChatMessageRole.System, 'system one'),
                makeTextMsg(vscode.LanguageModelChatMessageRole.User, 'hello'),
            ],
            { includeReasoningInRequest: true }
        )
        strictEqual(converter.systemContent, 'system one')
        converter.convertMessages(
            [makeTextMsg(vscode.LanguageModelChatMessageRole.User, 'hello')],
            { includeReasoningInRequest: true }
        )
        strictEqual(converter.systemContent, undefined)
    })

    test('marks the last user message as incomplete', () => {
        const converter = new ResponsesMessageConverter(makeModelInfo())
        const items = converter.convertMessages(
            [
                makeTextMsg(vscode.LanguageModelChatMessageRole.User, 'first'),
                makeTextMsg(vscode.LanguageModelChatMessageRole.User, 'last'),
            ],
            { includeReasoningInRequest: true }
        )
        const last = items[items.length - 1]
        strictEqual(last.type, 'message')
        strictEqual(last.role, 'user')
        strictEqual(last.status, 'incomplete')
    })

    test('deduplicates reasoning items with the same id', () => {
        const converter = new ResponsesMessageConverter(makeModelInfo())
        const messages = [
            makeTextMsg(vscode.LanguageModelChatMessageRole.User, 'hello'),
            {
                role: vscode.LanguageModelChatMessageRole.Assistant,
                name: undefined,
                content: [new vscode.LanguageModelThinkingPart('[REDACTED]', 'rs_dup', { encrypted_content: 'enc-blob' })],
            },
            {
                role: vscode.LanguageModelChatMessageRole.Assistant,
                name: undefined,
                content: [new vscode.LanguageModelThinkingPart('[REDACTED]', 'rs_dup', { encrypted_content: 'enc-blob' })],
            },
        ]
        const items = converter.convertMessages(messages, { includeReasoningInRequest: true })
        const reasoningItems = items.filter(i => i.type === 'reasoning')
        strictEqual(reasoningItems.length, 1)
    })
})
