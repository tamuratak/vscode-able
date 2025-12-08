import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { isAllowedCommand } from '../../../../src/lmtools/runinsandboxlib/validator.js'

suite('validator', () => {
    test('allows cd + nl + sed pipeline without file argument', () => {
        const cmd = "cd /Users/tamura/src/github/vscode-copilot-chat && nl -ba src/extension/prompts/node/inline/inlineChatFix3Prompt.tsx | sed -n '60,120p'"
        const ok = isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, true)
    })

    test('allows cd + nl + sed pipeline without file argument', () => {
        const cmd = "cd /Users/tamura/src/github/vscode-copilot-chat && nl -ba src/extension/prompts/node/inline/inlineChatFix3Prompt.tsx | sed -n '60,120p'"
        const ok = isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-able')
        assert.strictEqual(ok, false)
    })

    test('sed with file argument is disallowed', () => {
        const cmd = "sed -E -i.bak -e 's/old/new/g' -e '/^#/d' file"
        const ok = isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test('evil command is disallowed', () => {
        const cmd = 'grep ; evil_command'
        const ok = isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test('shell expansion is disallowed', () => {
        const cmd = 'grep $(ls -la)'
        const ok = isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test('shell expansion is disallowed', () => {
        const cmd = 'grep `date`'
        const ok = isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test('shell expansion is disallowed', () => {
        const cmd = 'grep <(date)'
        const ok = isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test('shell expansion is disallowed', () => {
        const cmd = 'grep ~/date'
        const ok = isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

})
