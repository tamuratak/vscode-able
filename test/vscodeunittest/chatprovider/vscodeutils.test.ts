import { strictEqual, deepStrictEqual } from 'node:assert'
import * as vscode from 'vscode'
import { isToolCallLoopDetected } from '../../../src/chatprovider/opencodegochatprovider/vscodeutils.js'

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

suite('isToolCallLoopDetected', () => {
    test('returns detected false for empty messages', () => {
        const result = isToolCallLoopDetected([])
        strictEqual(result.detected, false)
        strictEqual(result.repeatCount, 0)
    })

    test('returns detected false for single tool call', () => {
        const messages = [
            makeAssistantToolCallMsg('c1', 'read_file', { filePath: '/a.ts' }),
            makeUserToolResultMsg('c1', 'content'),
        ]
        const result = isToolCallLoopDetected(messages)
        strictEqual(result.detected, false)
        strictEqual(result.repeatCount, 1)
    })

    test('returns detected false for two identical tool calls', () => {
        const messages = [
            makeAssistantToolCallMsg('c1', 'read_file', { filePath: '/a.ts' }),
            makeUserToolResultMsg('c1', 'content'),
            makeAssistantToolCallMsg('c2', 'read_file', { filePath: '/a.ts' }),
            makeUserToolResultMsg('c2', 'content'),
        ]
        const result = isToolCallLoopDetected(messages)
        strictEqual(result.detected, false)
        strictEqual(result.repeatCount, 2)
    })

    test('detects loop with three identical tool calls', () => {
        const input = { filePath: '/a.ts', startLine: 1, endLine: 100 }
        const messages = [
            makeAssistantToolCallMsg('c1', 'read_file', input),
            makeUserToolResultMsg('c1', 'result1'),
            makeAssistantToolCallMsg('c2', 'read_file', input),
            makeUserToolResultMsg('c2', 'result2'),
            makeAssistantToolCallMsg('c3', 'read_file', input),
            makeUserToolResultMsg('c3', 'result3'),
        ]
        const result = isToolCallLoopDetected(messages)
        strictEqual(result.detected, true)
        strictEqual(result.callName, 'read_file')
        deepStrictEqual(result.callInput, input)
        strictEqual(result.repeatCount, 3)
    })

    test('detects loop with more than three repetitions', () => {
        const input = { filePath: '/b.ts' }
        const messages = [
            makeAssistantToolCallMsg('c1', 'grep', input),
            makeUserToolResultMsg('c1', 'r1'),
            makeAssistantToolCallMsg('c2', 'grep', input),
            makeUserToolResultMsg('c2', 'r2'),
            makeAssistantToolCallMsg('c3', 'grep', input),
            makeUserToolResultMsg('c3', 'r3'),
            makeAssistantToolCallMsg('c4', 'grep', input),
            makeUserToolResultMsg('c4', 'r4'),
        ]
        const result = isToolCallLoopDetected(messages)
        strictEqual(result.detected, true)
        strictEqual(result.repeatCount, 4)
    })

    test('returns detected false when loop is broken by different arguments', () => {
        const messages = [
            makeAssistantToolCallMsg('c1', 'read_file', { filePath: '/a.ts' }),
            makeUserToolResultMsg('c1', 'r1'),
            makeAssistantToolCallMsg('c2', 'read_file', { filePath: '/a.ts' }),
            makeUserToolResultMsg('c2', 'r2'),
            makeAssistantToolCallMsg('c3', 'read_file', { filePath: '/b.ts' }),
            makeUserToolResultMsg('c3', 'r3'),
        ]
        const result = isToolCallLoopDetected(messages)
        strictEqual(result.detected, false)
    })

    test('respects custom minRepeatCount', () => {
        const input = { filePath: '/a.ts' }
        const messages = [
            makeAssistantToolCallMsg('c1', 'read_file', input),
            makeUserToolResultMsg('c1', 'r1'),
            makeAssistantToolCallMsg('c2', 'read_file', input),
            makeUserToolResultMsg('c2', 'r2'),
        ]
        const result = isToolCallLoopDetected(messages, 2)
        strictEqual(result.detected, true)
        strictEqual(result.repeatCount, 2)
    })

    test('ignores text messages interspersed before the loop', () => {
        const input = { filePath: '/a.ts' }
        const messages = [
            makeTextMsg(vscode.LanguageModelChatMessageRole.User, 'hello'),
            makeTextMsg(vscode.LanguageModelChatMessageRole.Assistant, 'hi'),
            makeAssistantToolCallMsg('c1', 'read_file', input),
            makeUserToolResultMsg('c1', 'r1'),
            makeAssistantToolCallMsg('c2', 'read_file', input),
            makeUserToolResultMsg('c2', 'r2'),
            makeAssistantToolCallMsg('c3', 'read_file', input),
            makeUserToolResultMsg('c3', 'r3'),
        ]
        const result = isToolCallLoopDetected(messages)
        strictEqual(result.detected, true)
        strictEqual(result.repeatCount, 3)
    })

    test('returns detected false for messages with no tool calls', () => {
        const messages = [
            makeTextMsg(vscode.LanguageModelChatMessageRole.User, 'hello'),
            makeTextMsg(vscode.LanguageModelChatMessageRole.Assistant, 'hi'),
        ]
        const result = isToolCallLoopDetected(messages)
        strictEqual(result.detected, false)
        strictEqual(result.repeatCount, 0)
    })

    test('detects loop with multiple tool calls per assistant message', () => {
        const messages = [
            makeAssistantToolCallMsg('c1a', 'read_file', { filePath: '/a.ts' }),
            makeUserToolResultMsg('c1a', 'r1'),
            makeAssistantToolCallMsg('c2a', 'read_file', { filePath: '/a.ts' }),
            makeUserToolResultMsg('c2a', 'r2'),
            makeAssistantToolCallMsg('c3a', 'read_file', { filePath: '/a.ts' }),
            makeUserToolResultMsg('c3a', 'r3'),
        ]
        const result = isToolCallLoopDetected(messages)
        strictEqual(result.detected, true)
        strictEqual(result.callName, 'read_file')
        strictEqual(result.repeatCount, 3)
    })
})
