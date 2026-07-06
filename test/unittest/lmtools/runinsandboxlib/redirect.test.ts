import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { isAllowedPlanAppendCommand, collectPlanAppendTargets, resolveAllowedPlanAppendTarget } from '../../../../src/lmtools/runinsandboxlib/validatorlib/redirect.js'
import { parserInitialization } from '../../../../src/lmtools/runinsandboxlib/commandparser.js'

suite('isAllowedPlanAppendCommand', () => {
    setup(async () => {
        await parserInitialization
    })

    test('allows cat append heredoc to root planexec.md after cd to workspace root', async () => {
        const cmd = `cd /Users/tamura/src/github/lean4-examples/ex01 && cat >> planexec.md <<'EOF'

- 2026-03-28: update note
EOF`
        const result = await isAllowedPlanAppendCommand(cmd, ['/Users/tamura/src/github/lean4-examples/ex01'])
        assert.strictEqual(result, true)
    })

    test('allows cat append heredoc to root plan.md after cd to workspace root', async () => {
        const cmd = `cd /Users/tamura/src/github/lean4-examples/ex01 && cat >> plan.md <<'EOF'

- 2026-03-28: update note
EOF`
        const result = await isAllowedPlanAppendCommand(cmd, ['/Users/tamura/src/github/lean4-examples/ex01'])
        assert.strictEqual(result, true)
    })

    test('allows cat append heredoc to root memo.md after cd to workspace root', async () => {
        const cmd = `cd /Users/tamura/src/github/lean4-examples/ex01 && cat >> memo.md <<'EOF'

- 2026-03-28: update note
EOF`
        const result = await isAllowedPlanAppendCommand(cmd, ['/Users/tamura/src/github/lean4-examples/ex01'])
        assert.strictEqual(result, true)
    })

    test('disallows cat append heredoc to non-whitelisted file', async () => {
        const cmd = `cd /Users/tamura/src/github/lean4-examples/ex01 && cat >> notes.md <<'EOF'

- 2026-03-28: update note
EOF`
        const result = await isAllowedPlanAppendCommand(cmd, ['/Users/tamura/src/github/lean4-examples/ex01'])
        assert.strictEqual(result, false)
    })

    test('disallows relative append target when not anchored by cd to workspace root', async () => {
        const cmd = `cat >> plan.md <<'EOF'

- 2026-03-28: update note
EOF`
        const result = await isAllowedPlanAppendCommand(cmd, ['/Users/tamura/src/github/lean4-examples/ex01'])
        assert.strictEqual(result, false)
    })

    test('disallows when workspaceRootPath is undefined', async () => {
        const cmd = 'cat >> plan.md <<\'EOF\'\ndata\nEOF'
        const result = await isAllowedPlanAppendCommand(cmd, undefined)
        assert.strictEqual(result, false)
    })

    test('disallows cat with arguments (not bare cat)', async () => {
        const cmd = 'cat file.txt >> plan.md <<\'EOF\'\ndata\nEOF'
        const result = await isAllowedPlanAppendCommand(cmd, ['/Users/tamura/src/github/lean4-examples/ex01'])
        assert.strictEqual(result, false)
    })

    test('disallows cd to non-workspace path', async () => {
        const cmd = `cd /Users/tamura/src/github/other && cat >> plan.md <<'EOF'
data
EOF`
        const result = await isAllowedPlanAppendCommand(cmd, ['/Users/tamura/src/github/lean4-examples/ex01'])
        assert.strictEqual(result, false)
    })

    test('disallows more than two commands', async () => {
        const cmd = 'cd /path && echo x && cat >> plan.md <<\'EOF\'\ndata\nEOF'
        const result = await isAllowedPlanAppendCommand(cmd, ['/path'])
        assert.strictEqual(result, false)
    })

    // multi-root workspace tests
    test('allows cd to the second workspace root for plan.md append', async () => {
        const cmd = `cd /Users/tamura/src/github/vscode-able && cat >> plan.md <<'EOF'
- note
EOF`
        const result = await isAllowedPlanAppendCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat', '/Users/tamura/src/github/vscode-able'])
        assert.strictEqual(result, true)
    })

    test('allows cd to the first workspace root for plan.md append in multi-root', async () => {
        const cmd = `cd /Users/tamura/src/github/vscode-copilot-chat && cat >> plan.md <<'EOF'
- note
EOF`
        const result = await isAllowedPlanAppendCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat', '/Users/tamura/src/github/vscode-able'])
        assert.strictEqual(result, true)
    })

    test('disallows cd to non-workspace path in multi-root', async () => {
        const cmd = `cd /Users/tamura/src/github/other && cat >> plan.md <<'EOF'
- note
EOF`
        const result = await isAllowedPlanAppendCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat', '/Users/tamura/src/github/vscode-able'])
        assert.strictEqual(result, false)
    })
})

suite('collectPlanAppendTargets', () => {
    setup(async () => {
        await parserInitialization
    })

    test('collects target from cat append heredoc', async () => {
        const cmd = 'cat >> plan.md <<\'EOF\'\ndata\nEOF'
        const targets = await collectPlanAppendTargets(cmd)
        assert.deepStrictEqual(targets, ['plan.md'])
    })

    test('collects target from cd + cat append heredoc', async () => {
        const cmd = `cd /some/path && cat >> planexec.md <<'EOF'
data
EOF`
        const targets = await collectPlanAppendTargets(cmd)
        assert.deepStrictEqual(targets, ['planexec.md'])
    })

    test('returns empty array for command without redirection', async () => {
        const targets = await collectPlanAppendTargets('echo hello')
        assert.deepStrictEqual(targets, [])
    })
})

suite('resolveAllowedPlanAppendTarget', () => {
    test('resolves plan.md with relative path', () => {
        const result = resolveAllowedPlanAppendTarget('plan.md', '/workspace', true)
        assert.strictEqual(result, '/workspace/plan.md')
    })

    test('resolves planexec.md with relative path', () => {
        const result = resolveAllowedPlanAppendTarget('planexec.md', '/workspace', true)
        assert.strictEqual(result, '/workspace/planexec.md')
    })

    test('resolves memo.md with relative path', () => {
        const result = resolveAllowedPlanAppendTarget('memo.md', '/workspace', true)
        assert.strictEqual(result, '/workspace/memo.md')
    })

    test('resolves plan.md with absolute path', () => {
        const result = resolveAllowedPlanAppendTarget('/workspace/plan.md', '/workspace', false)
        assert.strictEqual(result, '/workspace/plan.md')
    })

    test('rejects non-whitelisted file name', () => {
        const result = resolveAllowedPlanAppendTarget('notes.md', '/workspace', true)
        assert.strictEqual(result, undefined)
    })

    test('rejects relative target when allowRelativeTarget is false', () => {
        const result = resolveAllowedPlanAppendTarget('plan.md', '/workspace', false)
        assert.strictEqual(result, undefined)
    })

    test('rejects absolute path outside workspace', () => {
        const result = resolveAllowedPlanAppendTarget('/other/plan.md', '/workspace', false)
        assert.strictEqual(result, undefined)
    })

    test('rejects relative target with path components', () => {
        const result = resolveAllowedPlanAppendTarget('subdir/plan.md', '/workspace', true)
        assert.strictEqual(result, undefined)
    })
})
