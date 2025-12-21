import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { isAllowedCommand } from '../../../../src/lmtools/runinsandboxlib/validator.js'

suite('validator', () => {
    test('allows cd + nl + sed pipeline without file argument', async () => {
        const cmd = "cd /Users/tamura/src/github/vscode-copilot-chat && nl -ba src/extension/prompts/node/inline/inlineChatFix3Prompt.tsx | sed -n '60,120p'"
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, true)
    })

    test('allows cd + nl + sed -n \'730,780p; 880,960p; 1500,1680p\'', async () => {
        const cmd = "cd /Users/tamura/src/github/vscode-copilot-chat && nl -ba src/vs/base/browser/ui/list/listView.ts | sed -n '730,780p; 880,960p; 1500,1680p'"
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, true)
    })

    test('disallows sed \'/version/ W warn.log\' package.json', async () => {
        const cmd = "sed '/version/ W warn.log' package.json"
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test('cd out of workspace is disallowed', async () => {
        const cmd = 'cd /Users/tamura/src/github/vscode'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test('sed -i is disallowed', async () => {
        const cmd = "sed -E -i.bak -e 's/old/new/g' -e '/^#/d' file"
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test('sed -I is disallowed', async () => {
        const cmd = "sed -E -Ibak -e 's/old/new/g' -e '/^#/d' file"
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test('rg --pre is disallowed', async () => {
        const cmd = 'rg --pre \'sed s/foo/bar/g\' pattern'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test('evil command is disallowed', async () => {
        const cmd = 'grep ; evil_command'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test('evil command is disallowed', async () => {
        const cmd = 'evil_command'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test('git status is allowed', async () => {
        const cmd = 'git status'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, true)
    })

    test('git status -sb is allowed', async () => {
        const cmd = 'git status -sb'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, true)
    })

    test('git push is disallowed', async () => {
        const cmd = 'git push origin main'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test('head command is allowed', async () => {
        const cmd = 'cat a.txt | head -n 10'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, true)
    })

    test('shell expansion is disallowed', async () => {
        const cmd = 'grep $(evil_command)'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test('shell expansion is disallowed', async () => {
        const cmd = 'grep `evil_command`'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test('shell expansion is disallowed', async () => {
        const cmd = 'grep ~/date'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test(' > redirection is disallowed', async () => {
        const cmd = 'echo aaa > a.txt'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test(' > redirection is disallowed', async () => {
        const cmd = `# Loop that overwrites the file each iteration
for i in 1 2 3; do
  # Overwrite file with current index
  echo "current: $i" > current.txt
done`
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })
})
