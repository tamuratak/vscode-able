import { strictEqual, deepStrictEqual } from 'node:assert'
import * as vscode from 'vscode'
import { createDedupProgress, extractLastToolCallSignatures, isToolCallLoopDetected } from '../../../src/chatprovider/opencodegochatprovider/vscodeutils.js'

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

suite('extractLastToolCallSignatures', () => {
    test('returns empty set for empty messages', () => {
        const result = extractLastToolCallSignatures([])
        strictEqual(result.size, 0)
    })

    test('returns empty set when there are no tool calls', () => {
        const messages = [
            makeTextMsg(vscode.LanguageModelChatMessageRole.User, 'hello'),
            makeTextMsg(vscode.LanguageModelChatMessageRole.Assistant, 'hi'),
        ]
        const result = extractLastToolCallSignatures(messages)
        strictEqual(result.size, 0)
    })

    test('returns empty set when last assistant message has no replace_string_in_file', () => {
        const messages = [
            makeAssistantToolCallMsg('c1', 'read_file', { filePath: '/a.ts' }),
            makeUserToolResultMsg('c1', 'content'),
        ]
        const result = extractLastToolCallSignatures(messages)
        strictEqual(result.size, 0)
    })

    test('returns signature for a single replace_string_in_file call', () => {
        const input = { filePath: '/a.ts', oldString: 'foo', newString: 'bar' }
        const messages = [
            makeAssistantToolCallMsg('c1', 'replace_string_in_file', input),
        ]
        const result = extractLastToolCallSignatures(messages)
        strictEqual(result.size, 1)
    })

    test('returns multiple signatures for multiple replace_string_in_file calls', () => {
        const messages = [
            {
                role: vscode.LanguageModelChatMessageRole.Assistant,
                content: [
                    new vscode.LanguageModelToolCallPart('c1', 'replace_string_in_file', { filePath: '/a.ts', oldString: 'foo', newString: 'bar' }),
                    new vscode.LanguageModelToolCallPart('c2', 'replace_string_in_file', { filePath: '/b.ts', oldString: 'baz', newString: 'qux' }),
                ],
                name: undefined,
            },
        ]
        const result = extractLastToolCallSignatures(messages)
        strictEqual(result.size, 2)
    })

    test('ignores non-target tool calls in mixed assistant message', () => {
        const messages = [
            {
                role: vscode.LanguageModelChatMessageRole.Assistant,
                content: [
                    new vscode.LanguageModelToolCallPart('c1', 'read_file', { filePath: '/a.ts' }),
                    new vscode.LanguageModelToolCallPart('c2', 'replace_string_in_file', { filePath: '/a.ts', oldString: 'foo', newString: 'bar' }),
                ],
                name: undefined,
            },
        ]
        const result = extractLastToolCallSignatures(messages)
        strictEqual(result.size, 1)
    })

    test('produces same signature regardless of input key order', () => {
        const messagesA = [
            makeAssistantToolCallMsg('c1', 'replace_string_in_file', { filePath: '/a.ts', oldString: 'foo', newString: 'bar' }),
        ]
        const messagesB = [
            makeAssistantToolCallMsg('c1', 'replace_string_in_file', { newString: 'bar', filePath: '/a.ts', oldString: 'foo' }),
        ]
        const sigA = extractLastToolCallSignatures(messagesA)
        const sigB = extractLastToolCallSignatures(messagesB)
        strictEqual(sigA.size, 1)
        strictEqual(sigB.size, 1)
        deepStrictEqual([...sigA], [...sigB])
    })

    test('considers only the last assistant message', () => {
        const messages = [
            makeAssistantToolCallMsg('c1', 'replace_string_in_file', { filePath: '/a.ts', oldString: 'x', newString: 'y' }),
            makeUserToolResultMsg('c1', 'done'),
            makeAssistantToolCallMsg('c2', 'read_file', { filePath: '/b.ts' }),
        ]
        const result = extractLastToolCallSignatures(messages)
        strictEqual(result.size, 0)
    })

    test('returns empty set when last assistant message has only text', () => {
        const messages = [
            makeAssistantToolCallMsg('c1', 'replace_string_in_file', { filePath: '/a.ts', oldString: 'x', newString: 'y' }),
            makeUserToolResultMsg('c1', 'done'),
            makeTextMsg(vscode.LanguageModelChatMessageRole.Assistant, 'Here is the result.'),
        ]
        const result = extractLastToolCallSignatures(messages)
        strictEqual(result.size, 0)
    })
})

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

suite('createDedupProgress', () => {
    test('passes through non-target tool calls unchanged', () => {
        const { progress, reported } = createMockProgress()
        const wrapper = createDedupProgress(progress, new Set())
        const part = new vscode.LanguageModelToolCallPart('c1', 'read_file', { filePath: '/a.ts' })
        wrapper.report(part)
        strictEqual(reported.length, 1)
        strictEqual(reported[0], part)
    })

    test('passes through new replace_string_in_file calls', () => {
        const { progress, reported } = createMockProgress()
        const wrapper = createDedupProgress(progress, new Set())
        const part = new vscode.LanguageModelToolCallPart('c1', 'replace_string_in_file', {
            filePath: '/a.ts', oldString: 'foo', newString: 'bar',
        })
        wrapper.report(part)
        strictEqual(reported.length, 1)
        strictEqual(reported[0], part)
    })

    test('blocks duplicate replace_string_in_file from previousSignatures', () => {
        const { progress, reported } = createMockProgress()
        const prevSigs = new Set<string>(['{"filePath":"/a.ts","newString":"bar","oldString":"foo"}'])
        const wrapper = createDedupProgress(progress, prevSigs)
        const part = new vscode.LanguageModelToolCallPart('c1', 'replace_string_in_file', {
            filePath: '/a.ts', oldString: 'foo', newString: 'bar',
        })
        wrapper.report(part)
        strictEqual(reported.length, 2)
        strictEqual(reported[0] instanceof vscode.LanguageModelTextPart, true)
        strictEqual(reported[1] instanceof vscode.LanguageModelTextPart, true)
    })

    test('blocks second identical call within same response', () => {
        const { progress, reported } = createMockProgress()
        const wrapper = createDedupProgress(progress, new Set())
        const input = { filePath: '/a.ts', oldString: 'foo', newString: 'bar' }
        const part1 = new vscode.LanguageModelToolCallPart('c1', 'replace_string_in_file', input)
        const part2 = new vscode.LanguageModelToolCallPart('c2', 'replace_string_in_file', input)
        wrapper.report(part1)
        wrapper.report(part2)
        // First passes through, second is blocked with 2 text messages
        strictEqual(reported.length, 3)
        strictEqual(reported[0], part1)
        strictEqual(reported[1] instanceof vscode.LanguageModelTextPart, true)
        strictEqual(reported[2] instanceof vscode.LanguageModelTextPart, true)
    })

    test('passes through text parts unchanged', () => {
        const { progress, reported } = createMockProgress()
        const wrapper = createDedupProgress(progress, new Set())
        const textPart = new vscode.LanguageModelTextPart('hello')
        wrapper.report(textPart)
        strictEqual(reported.length, 1)
        strictEqual(reported[0], textPart)
    })

    test('does not mutate the input previousSignatures set', () => {
        const prevSigs = new Set<string>()
        createDedupProgress(createMockProgress().progress, prevSigs)
        strictEqual(prevSigs.size, 0)
    })

    test('passes through two parallel replace_string_in_file calls to different files', () => {
        const { progress, reported } = createMockProgress()
        const wrapper = createDedupProgress(progress, new Set())
        const part1 = new vscode.LanguageModelToolCallPart('c1', 'replace_string_in_file', {
            filePath: '/a.ts', oldString: 'foo', newString: 'bar',
        })
        const part2 = new vscode.LanguageModelToolCallPart('c2', 'replace_string_in_file', {
            filePath: '/b.ts', oldString: 'baz', newString: 'qux',
        })
        wrapper.report(part1)
        wrapper.report(part2)
        strictEqual(reported.length, 2)
        strictEqual(reported[0], part1)
        strictEqual(reported[1], part2)
    })
})
