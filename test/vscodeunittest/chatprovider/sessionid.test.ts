import { strictEqual, deepStrictEqual } from 'node:assert'
import * as vscode from 'vscode'
import { extractSessionId, emitSessionIdPart, stripSessionIdParts } from '../../../src/chatprovider/opencodegochatprovider/sessionid.js'

const SESSION_ID = '123e4567-e89b-12d3-a456-426614174000'

function markerText(): string {
    return `\n<!-- ABLE_OPENCODE_SESSION_ID: ${SESSION_ID} -->\n`
}

function makeMessage(
    role: vscode.LanguageModelChatMessageRole,
    content: vscode.LanguageModelChatRequestMessage['content']
): vscode.LanguageModelChatRequestMessage {
    return { role, content, name: undefined }
}

function textOf(message: vscode.LanguageModelChatRequestMessage): string[] {
    return message.content
        .filter((part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart)
        .map(part => part.value)
}

suite('extractSessionId', () => {
    test('returns undefined for empty messages', () => {
        strictEqual(extractSessionId([]), undefined)
    })

    test('extracts the id from a standalone marker part', () => {
        const messages = [
            makeMessage(vscode.LanguageModelChatMessageRole.User, [new vscode.LanguageModelTextPart('hello')]),
            makeMessage(vscode.LanguageModelChatMessageRole.Assistant, [new vscode.LanguageModelTextPart(markerText())]),
        ]
        strictEqual(extractSessionId(messages), SESSION_ID)
    })

    test('extracts the id from a marker concatenated with the response body', () => {
        const messages = [
            makeMessage(vscode.LanguageModelChatMessageRole.Assistant, [
                new vscode.LanguageModelTextPart(markerText() + 'Here is the answer.'),
            ]),
        ]
        strictEqual(extractSessionId(messages), SESSION_ID)
    })

    test('returns undefined when no marker exists', () => {
        const messages = [
            makeMessage(vscode.LanguageModelChatMessageRole.Assistant, [new vscode.LanguageModelTextPart('no marker here')]),
        ]
        strictEqual(extractSessionId(messages), undefined)
    })

    test('prefers the most recent marker', () => {
        const older = '00000000-0000-0000-0000-000000000000'
        const messages = [
            makeMessage(vscode.LanguageModelChatMessageRole.Assistant, [
                new vscode.LanguageModelTextPart(`<!-- ABLE_OPENCODE_SESSION_ID: ${older} -->`),
            ]),
            makeMessage(vscode.LanguageModelChatMessageRole.Assistant, [new vscode.LanguageModelTextPart(markerText())]),
        ]
        strictEqual(extractSessionId(messages), SESSION_ID)
    })

    test('ignores markers inside user messages', () => {
        const messages = [
            makeMessage(vscode.LanguageModelChatMessageRole.User, [new vscode.LanguageModelTextPart(markerText())]),
        ]
        strictEqual(extractSessionId(messages), undefined)
    })
})

suite('emitSessionIdPart', () => {
    test('reports a marker part tagged for the assistant audience', () => {
        const reported: vscode.LanguageModelResponsePart2[] = []
        const progress: vscode.Progress<vscode.LanguageModelResponsePart2> = { report: part => reported.push(part) }
        emitSessionIdPart(SESSION_ID, progress)
        strictEqual(reported.length, 1)
        const part = reported[0]
        if (!(part instanceof vscode.LanguageModelTextPart2)) {
            throw new Error('expected a LanguageModelTextPart2')
        }
        deepStrictEqual(part.audience, [vscode.LanguageModelPartAudience.Assistant])
        strictEqual(extractSessionId([makeMessage(vscode.LanguageModelChatMessageRole.Assistant, [part])]), SESSION_ID)
    })
})

suite('stripSessionIdParts', () => {
    test('keeps the response body when the marker shares a text part with it', () => {
        const messages = [
            makeMessage(vscode.LanguageModelChatMessageRole.Assistant, [
                new vscode.LanguageModelTextPart(markerText() + 'Here is the answer.'),
            ]),
        ]
        const stripped = stripSessionIdParts(messages)
        deepStrictEqual(textOf(stripped[0]), ['\nHere is the answer.'])
    })

    test('removes a marker-only part and drops the message when nothing remains', () => {
        const messages = [
            makeMessage(vscode.LanguageModelChatMessageRole.User, [new vscode.LanguageModelTextPart('question')]),
            makeMessage(vscode.LanguageModelChatMessageRole.Assistant, [new vscode.LanguageModelTextPart(markerText())]),
        ]
        const stripped = stripSessionIdParts(messages)
        strictEqual(stripped.length, 1)
        strictEqual(stripped[0].role, vscode.LanguageModelChatMessageRole.User)
        deepStrictEqual(textOf(stripped[0]), ['question'])
    })

    test('leaves messages without markers untouched', () => {
        const messages = [
            makeMessage(vscode.LanguageModelChatMessageRole.User, [new vscode.LanguageModelTextPart('question')]),
            makeMessage(vscode.LanguageModelChatMessageRole.Assistant, [new vscode.LanguageModelTextPart('answer')]),
        ]
        const stripped = stripSessionIdParts(messages)
        deepStrictEqual(stripped, messages)
    })

    test('keeps marker text inside user messages intact', () => {
        const messages = [
            makeMessage(vscode.LanguageModelChatMessageRole.User, [new vscode.LanguageModelTextPart(markerText() + 'please help')]),
        ]
        const stripped = stripSessionIdParts(messages)
        deepStrictEqual(textOf(stripped[0]), [markerText() + 'please help'])
    })

    test('removes every marker occurrence and empty parts within one message', () => {
        const messages = [
            makeMessage(vscode.LanguageModelChatMessageRole.Assistant, [
                new vscode.LanguageModelTextPart(markerText()),
                new vscode.LanguageModelTextPart(markerText() + 'answer body'),
            ]),
        ]
        const stripped = stripSessionIdParts(messages)
        strictEqual(stripped.length, 1)
        deepStrictEqual(textOf(stripped[0]), ['answer body'])
    })

    test('preserves non-text parts of modified messages', () => {
        const toolCall = new vscode.LanguageModelToolCallPart('c1', 'read_file', { filePath: '/a.ts' })
        const messages = [
            makeMessage(vscode.LanguageModelChatMessageRole.Assistant, [
                new vscode.LanguageModelTextPart(markerText()),
                toolCall,
            ]),
        ]
        const stripped = stripSessionIdParts(messages)
        strictEqual(stripped.length, 1)
        strictEqual(stripped[0].content.length, 1)
        strictEqual(stripped[0].content[0], toolCall)
    })
})
