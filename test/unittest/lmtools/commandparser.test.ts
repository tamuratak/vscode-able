import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { parseCommand } from '../../../src/lmtools/runinsandboxlib/commandparser.js'

suite('command parser', () => {
    test('extracts cd target and a simple pipeline', () => {
        const parsed = parseCommand('cd /Users/tamura/src/github/vscode-copilot-chat && ls -la')
        assert.strictEqual(parsed.workingDirectory, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(parsed.sequences.length, 1)
        assert.deepStrictEqual(parsed.sequences[0], {
            pipeline: [{ command: 'ls', args: ['-la'] }]
        })
    })

    test('supports pipelines joined by pipe characters', () => {
        const parsed = parseCommand("nl -ba src/extension/prompts/node/inline/inlineChatFix3Prompt.tsx | sed -n '60,120p'")
        assert.strictEqual(parsed.workingDirectory, undefined)
        const pipeline = parsed.sequences[0].pipeline
        assert.deepStrictEqual(pipeline, [
            { command: 'nl', args: ['-ba', 'src/extension/prompts/node/inline/inlineChatFix3Prompt.tsx'] },
            { command: 'sed', args: ['-n', '60,120p'] }
        ])
    })

    test('respects quoted arguments and multiple sequences', () => {
        const parsed = parseCommand('echo "hello world" && grep world file.txt')
        assert.strictEqual(parsed.workingDirectory, undefined)
        assert.strictEqual(parsed.sequences.length, 2)
        assert.deepStrictEqual(parsed.sequences[0], {
            pipeline: [{ command: 'echo', args: ['hello world'] }]
        })
        assert.deepStrictEqual(parsed.sequences[1], {
            pipeline: [{ command: 'grep', args: ['world', 'file.txt'] }]
        })
    })

    test('does not split on | or && inside quotes', () => {
        const parsed = parseCommand('echo "a | b && c" | sed -n \'1,1p\' && echo "final | && end"')
        assert.strictEqual(parsed.workingDirectory, undefined)
        assert.strictEqual(parsed.sequences.length, 2)

        const first = parsed.sequences[0].pipeline
        assert.deepStrictEqual(first, [
            { command: 'echo', args: ['a | b && c'] },
            { command: 'sed', args: ['-n', '1,1p'] }
        ])

        assert.deepStrictEqual(parsed.sequences[1], {
            pipeline: [{ command: 'echo', args: ['final | && end'] }]
        })
    })
})
