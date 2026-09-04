import { strictEqual, notStrictEqual } from 'node:assert'
import * as vscode from 'vscode'
import { deriveSessionId } from '../../../src/chatprovider/opencodegochatprovider/sessionid.js'

const SESSION_ID_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function makeMessage(
    role: vscode.LanguageModelChatMessageRole,
    content: vscode.LanguageModelChatRequestMessage['content']
): vscode.LanguageModelChatRequestMessage {
    return { role, content, name: undefined }
}

suite('deriveSessionId', () => {
    test('is deterministic for identical input', async () => {
        const messages = [
            makeMessage(vscode.LanguageModelChatMessageRole.User, [new vscode.LanguageModelTextPart('hello')]),
        ]
        strictEqual(await deriveSessionId('model-a', messages), await deriveSessionId('model-a', messages))
    })

    test('yields a UUID-shaped id', async () => {
        const messages = [
            makeMessage(vscode.LanguageModelChatMessageRole.User, [new vscode.LanguageModelTextPart('hello')]),
        ]
        strictEqual(SESSION_ID_UUID_PATTERN.test(await deriveSessionId('model-a', messages)), true)
    })

    test('changes when the model changes', async () => {
        const messages = [
            makeMessage(vscode.LanguageModelChatMessageRole.User, [new vscode.LanguageModelTextPart('hello')]),
        ]
        notStrictEqual(await deriveSessionId('model-a', messages), await deriveSessionId('model-b', messages))
    })

    test('changes when the leading messages change', async () => {
        const messagesA = [
            makeMessage(vscode.LanguageModelChatMessageRole.User, [new vscode.LanguageModelTextPart('hello')]),
        ]
        const messagesB = [
            makeMessage(vscode.LanguageModelChatMessageRole.User, [new vscode.LanguageModelTextPart('world')]),
        ]
        notStrictEqual(await deriveSessionId('model-a', messagesA), await deriveSessionId('model-a', messagesB))
    })

    test('is unaffected by messages beyond the first three', async () => {
        const firstThree = [
            makeMessage(vscode.LanguageModelChatMessageRole.User, [new vscode.LanguageModelTextPart('hello')]),
            makeMessage(vscode.LanguageModelChatMessageRole.Assistant, [new vscode.LanguageModelTextPart('hi')]),
            makeMessage(vscode.LanguageModelChatMessageRole.User, [new vscode.LanguageModelTextPart('more')]),
        ]
        const withExtra = [...firstThree, makeMessage(vscode.LanguageModelChatMessageRole.Assistant, [new vscode.LanguageModelTextPart('changed answer')])]
        strictEqual(await deriveSessionId('model-a', firstThree), await deriveSessionId('model-a', withExtra))
    })

    test('works with fewer than three messages', async () => {
        const messages = [
            makeMessage(vscode.LanguageModelChatMessageRole.User, [new vscode.LanguageModelTextPart('hello')]),
        ]
        strictEqual(SESSION_ID_UUID_PATTERN.test(await deriveSessionId('model-a', messages)), true)
    })

    test('distinguishes tool call parts from text', async () => {
        const textMessages = [
            makeMessage(vscode.LanguageModelChatMessageRole.Assistant, [new vscode.LanguageModelTextPart('answer')]),
        ]
        const toolCallMessages = [
            makeMessage(vscode.LanguageModelChatMessageRole.Assistant, [new vscode.LanguageModelToolCallPart('c1', 'read_file', { filePath: '/a.ts' })]),
        ]
        notStrictEqual(await deriveSessionId('model-a', textMessages), await deriveSessionId('model-a', toolCallMessages))
    })
})
