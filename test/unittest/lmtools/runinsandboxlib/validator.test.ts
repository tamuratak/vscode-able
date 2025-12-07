import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { validateCommand } from '../../../../src/lmtools/runinsandboxlib/validator.js'

suite('validator', () => {
    test('allows cd + nl + sed pipeline without file argument', () => {
        const cmd = "cd /Users/tamura/src/github/vscode-copilot-chat && nl -ba src/extension/prompts/node/inline/inlineChatFix3Prompt.tsx | sed -n '60,120p'"
        const ok = validateCommand(cmd)
        assert.strictEqual(ok, true)
    })
})
