import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { commandStartsWith, exactMatchCommand, isAllowedCommand, isInside, parseGitCommand } from '../../../../src/lmtools/runinsandboxlib/validator.js'
import type { CommandNode } from '../../../../src/lmtools/runinsandboxlib/commandparser.js'

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

    test('allow cd /Users/tamura/src/github/vscode-copilot-chat && rg -n "visibility" src/vs/workbench/contrib/chat/common/promptSyntax/service/promptsServiceImpl.ts', async () => {
        const cmd = 'cd /Users/tamura/src/github/vscode-copilot-chat && rg -n "visibility" src/vs/workbench/contrib/chat/common/promptSyntax/service/promptsServiceImpl.ts'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, true)
    })

    test("allow nl -ba /Users/tamura/src/github/vscode-copilot-chat/src/vs/workbench/contrib/chat/browser/widget/chatListRenderer.ts | sed -n '1390,1465p;2200,2335p'", async () => {
        const cmd = "nl -ba /Users/tamura/src/github/vscode-copilot-chat/src/vs/workbench/contrib/chat/browser/widget/chatListRenderer.ts | sed -n '1390,1465p;2200,2335p'"
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, true)
    })

    test("allow cd /Users/tamura/src/github/vscode-copilot-chat && sed -n '2320,2395p' src/vs/workbench/api/common/extHost.protocol.ts | cat -n", async () => {
        const cmd = "cd /Users/tamura/src/github/vscode-copilot-chat && sed -n '2320,2395p' src/vs/workbench/api/common/extHost.protocol.ts | cat -n"
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, true)
    })

    test("cd /Users/tamura/src/github/vscode && find src -maxdepth 2 -type f | sed -n '1,120p'", async () => {
        const cmd = "cd /Users/tamura/src/github/vscode-copilot-chat && find src -maxdepth 2 -type f | sed -n '1,120p'"
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, true)
    })

    test("cd /Users/tamura/src/github/vscode && find src -exec evil -maxdepth 2 -type f | sed -n '1,120p'", async () => {
        const cmd = "cd /Users/tamura/src/github/vscode-copilot-chat && find src -exec evil -maxdepth 2 -type f | sed -n '1,120p'"
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test("allow sed -n '100,150p' /Users/tamura/src/github/vscode-copilot-chat/src/vs/workbench/contrib/chat/browser/widget/chatListRenderer.ts", async () => {
        const cmd = "sed -n '100,150p' /Users/tamura/src/github/vscode-copilot-chat/src/vs/workbench/contrib/chat/browser/widget/chatListRenderer.ts"
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, true)
    })

    test("allow sed -n '/class LanguageModelDataPart {/,/^[[:space:]]*}/p' /path/to/file.d.ts", async () => {
        const cmd = "sed -n '/class LanguageModelDataPart {/,/^[[:space:]]*}/p' /Users/tamura/src/github/vscode-copilot-chat/node_modules/@types/vscode/index.d.ts"
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, true)
    })

    test("allow sed -n '/pattern1/,/pattern2/p' /path/to/file", async () => {
        const cmd = "sed -n '/^import/,/^}/p' /Users/tamura/src/github/vscode-copilot-chat/src/main.ts"
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, true)
    })

    test("allow sed -n '5,/pattern/p' (mixed numeric and regex address)", async () => {
        const cmd = "sed -n '5,/^}/p' /Users/tamura/src/github/vscode-copilot-chat/src/main.ts"
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, true)
    })

    test("allow sed -n '/pattern/p' (single regex address)", async () => {
        const cmd = "sed -n '/^class/p' /Users/tamura/src/github/vscode-copilot-chat/src/main.ts"
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, true)
    })

    test("allow sed -n '/pattern1/,/pattern2/p; 10,20p' (mixed regex and numeric ranges)", async () => {
        const cmd = "sed -n '/^class/,/^}/p; 10,20p' /Users/tamura/src/github/vscode-copilot-chat/src/main.ts"
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

    test('sed w command writes to file and is disallowed', async () => {
        const cmd = "sed -n '/pattern/w outfile' infile"
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test('sed w command with numeric range is disallowed', async () => {
        const cmd = "sed -n '1,10w outfile' infile"
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test('sed w command without -n is disallowed', async () => {
        const cmd = "sed '/pattern/w outfile' infile"
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

    test('git -C /Users/tamura/src/github/vscode-copilot-chat --no-pager status -sb is allowed', async () => {
        const cmd = 'git -C /Users/tamura/src/github/vscode-copilot-chat --no-pager status -sb'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, true)
    })

    test('git -C /Users/tamura/src/github/vscode --no-pager status -sb is disallowed', async () => {
        const cmd = 'git -C /Users/tamura/src/github/vscode --no-pager status -sb'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
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

    test('allows cat append heredoc to root planexec.md after cd to workspace root', async () => {
        const cmd = `cd /Users/tamura/src/github/lean4-examples/ex01 && cat >> planexec.md <<'EOF'

- 2026-03-28: update note
EOF`
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/lean4-examples/ex01')
        assert.strictEqual(ok, true)
    })

    test('allows cat append heredoc to root plan.md after cd to workspace root', async () => {
        const cmd = `cd /Users/tamura/src/github/lean4-examples/ex01 && cat >> plan.md <<'EOF'

- 2026-03-28: update note
EOF`
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/lean4-examples/ex01')
        assert.strictEqual(ok, true)
    })

    test('allows cat append heredoc to root memo.md after cd to workspace root', async () => {
        const cmd = `cd /Users/tamura/src/github/lean4-examples/ex01 && cat >> memo.md <<'EOF'

- 2026-03-28: update note
EOF`
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/lean4-examples/ex01')
        assert.strictEqual(ok, true)
    })

    test('disallows cat append heredoc to non-whitelisted file', async () => {
        const cmd = `cd /Users/tamura/src/github/lean4-examples/ex01 && cat >> notes.md <<'EOF'

- 2026-03-28: update note
EOF`
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/lean4-examples/ex01')
        assert.strictEqual(ok, false)
    })

    test('disallows relative append target when not anchored by cd to workspace root', async () => {
        const cmd = `cat >> plan.md <<'EOF'

- 2026-03-28: update note
EOF`
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/lean4-examples/ex01')
        assert.strictEqual(ok, false)
    })

    test('allows > redirection to /dev/null', async () => {
        const cmd = 'echo hello > /dev/null'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, true)
    })

    test('allows rg with > /dev/null redirection', async () => {
        const cmd = 'rg pattern file.txt > /dev/null'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, true)
    })

    test('allows 2>&1 with > /dev/null redirection', async () => {
        const cmd = 'rg pattern file.txt > /dev/null 2>&1'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, true)
    })

    test('allows 2> /dev/null redirection', async () => {
        const cmd = 'ls 2>/dev/null'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, true)
    })

    test('disallows > redirection to regular file even with /dev/null', async () => {
        const cmd = 'echo hello > output.txt > /dev/null'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test('disallows >> redirection to regular file even with /dev/null', async () => {
        const cmd = 'echo hello >> output.txt > /dev/null'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test('disallows >& redirection to regular file even with /dev/null', async () => {
        const cmd = 'echo hello >& output.txt > /dev/null'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test('disallows >& redirection to regular file even with /dev/null', async () => {
        const cmd = 'echo hello >& output.txt 2 > /dev/null'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test('disallows 2> redirection to file', async () => {
        const cmd = 'rg pattern file.txt 2> error.log'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })

    test('disallows &> redirection to file', async () => {
        const cmd = 'rg pattern file.txt &> output.txt'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })


    test('disallows >| redirection to file', async () => {
        const cmd = 'echo hello >| output.txt'
        const ok = await isAllowedCommand(cmd, '/Users/tamura/src/github/vscode-copilot-chat')
        assert.strictEqual(ok, false)
    })
})

suite('exactMatchCommand', () => {
    test('returns true when pattern matches command exactly', () => {
        const cmd: CommandNode = { command: 'rg', args: ['-n', 'pattern', 'file.txt'] }
        assert.strictEqual(exactMatchCommand(['rg', '-n', 'pattern', 'file.txt'], cmd), true)
    })

    test('returns false when pattern has fewer elements than command', () => {
        const cmd: CommandNode = { command: 'rg', args: ['-n', 'pattern', 'file.txt'] }
        assert.strictEqual(exactMatchCommand(['rg', '-n'], cmd), false)
    })

    test('returns false when pattern has more elements than command', () => {
        const cmd: CommandNode = { command: 'rg', args: ['-n'] }
        assert.strictEqual(exactMatchCommand(['rg', '-n', 'pattern'], cmd), false)
    })

    test('returns false when command name does not match', () => {
        const cmd: CommandNode = { command: 'grep', args: ['-n'] }
        assert.strictEqual(exactMatchCommand(['rg', '-n'], cmd), false)
    })

    test('matches with RegExp pattern', () => {
        const cmd: CommandNode = { command: 'sed', args: ['-n', '1,10p'] }
        assert.strictEqual(exactMatchCommand(['sed', '-n', /^\d+,\d+p$/], cmd), true)
    })

    test('returns false when RegExp pattern does not match', () => {
        const cmd: CommandNode = { command: 'sed', args: ['-n', 'abc'] }
        assert.strictEqual(exactMatchCommand(['sed', '-n', /^\d+,\d+p$/], cmd), false)
    })

    test('matches command with no args', () => {
        const cmd: CommandNode = { command: 'ls', args: [] }
        assert.strictEqual(exactMatchCommand(['ls'], cmd), true)
    })

    test('returns false for empty pattern vs command with no args', () => {
        const cmd: CommandNode = { command: 'ls', args: [] }
        assert.strictEqual(exactMatchCommand([], cmd), false)
    })
})

suite('commandStartsWith', () => {
    test('returns true when command name matches', () => {
        const cmd: CommandNode = { command: 'git', args: ['status', '-sb'] }
        assert.strictEqual(commandStartsWith(['git', 'status'], cmd), true)
    })

    test('returns true when full pattern matches', () => {
        const cmd: CommandNode = { command: 'git', args: ['status', '-sb'] }
        assert.strictEqual(commandStartsWith(['git', 'status', '-sb'], cmd), true)
    })

    test('returns true when pattern is shorter than command', () => {
        const cmd: CommandNode = { command: 'git', args: ['status', '-sb'] }
        assert.strictEqual(commandStartsWith(['git'], cmd), true)
    })

    test('returns false when command name does not match', () => {
        const cmd: CommandNode = { command: 'rg', args: ['pattern'] }
        assert.strictEqual(commandStartsWith(['git', 'status'], cmd), false)
    })

    test('returns false when arg does not match', () => {
        const cmd: CommandNode = { command: 'git', args: ['push'] }
        assert.strictEqual(commandStartsWith(['git', 'status'], cmd), false)
    })

    test('matches with RegExp pattern', () => {
        const cmd: CommandNode = { command: 'find', args: ['-delete', '-name', '*.txt'] }
        assert.strictEqual(commandStartsWith(['find', /^-delete$/], cmd), true)
    })

    test('returns false when RegExp pattern does not match', () => {
        const cmd: CommandNode = { command: 'find', args: ['-name', '*.txt'] }
        assert.strictEqual(commandStartsWith(['find', /^-delete$/], cmd), false)
    })

    test('empty pattern matches any command', () => {
        const cmd: CommandNode = { command: 'anything', args: ['arg1'] }
        assert.strictEqual(commandStartsWith([], cmd), false)
    })
})

suite('parseGitCommand', () => {
    test('returns undefined for non-git command', () => {
        const cmd: CommandNode = { command: 'rg', args: ['pattern'] }
        assert.strictEqual(parseGitCommand(cmd), undefined)
    })

    test('parses git status', () => {
        const cmd: CommandNode = { command: 'git', args: ['status'] }
        const result = parseGitCommand(cmd)
        assert.deepStrictEqual(result, { subCommand: 'status', subCommandArgs: [], mainArgs: [], cPath: undefined })
    })

    test('parses git log with args', () => {
        const cmd: CommandNode = { command: 'git', args: ['log', '--oneline'] }
        const result = parseGitCommand(cmd)
        assert.deepStrictEqual(result, { subCommand: 'log', subCommandArgs: ['--oneline'], mainArgs: [], cPath: undefined })
    })

    test('parses git with -C option', () => {
        const cmd: CommandNode = { command: 'git', args: ['-C', '/some/path', 'status'] }
        const result = parseGitCommand(cmd)
        assert.deepStrictEqual(result, { subCommand: 'status', subCommandArgs: [], mainArgs: [], cPath: '/some/path' })
    })

    test('parses git with --no-pager option', () => {
        const cmd: CommandNode = { command: 'git', args: ['--no-pager', 'diff'] }
        const result = parseGitCommand(cmd)
        assert.deepStrictEqual(result, { subCommand: 'diff', subCommandArgs: [], mainArgs: ['--no-pager'], cPath: undefined })
    })

    test('parses git with -C and --no-pager', () => {
        const cmd: CommandNode = { command: 'git', args: ['-C', '/some/path', '--no-pager', 'status', '-sb'] }
        const result = parseGitCommand(cmd)
        assert.deepStrictEqual(result, { subCommand: 'status', subCommandArgs: ['-sb'], mainArgs: ['--no-pager'], cPath: '/some/path' })
    })

    test('parses git with --no-pager before -C', () => {
        const cmd: CommandNode = { command: 'git', args: ['--no-pager', '-C', '/some/path', 'status'] }
        const result = parseGitCommand(cmd)
        assert.deepStrictEqual(result, { subCommand: 'status', subCommandArgs: [], mainArgs: ['--no-pager'], cPath: '/some/path' })
    })

    test('returns undefined for unsupported sub-command', () => {
        const cmd: CommandNode = { command: 'git', args: ['push'] }
        assert.strictEqual(parseGitCommand(cmd), undefined)
    })

    test('returns undefined for unrecognized flag', () => {
        const cmd: CommandNode = { command: 'git', args: ['--verbose', 'status'] }
        assert.strictEqual(parseGitCommand(cmd), undefined)
    })

    test('parses git show', () => {
        const cmd: CommandNode = { command: 'git', args: ['show', 'HEAD'] }
        const result = parseGitCommand(cmd)
        assert.deepStrictEqual(result, { subCommand: 'show', subCommandArgs: ['HEAD'], mainArgs: [], cPath: undefined })
    })

    test('parses git blame', () => {
        const cmd: CommandNode = { command: 'git', args: ['blame', 'file.ts'] }
        const result = parseGitCommand(cmd)
        assert.deepStrictEqual(result, { subCommand: 'blame', subCommandArgs: ['file.ts'], mainArgs: [], cPath: undefined })
    })

    test('parses git rev-parse', () => {
        const cmd: CommandNode = { command: 'git', args: ['rev-parse', 'HEAD'] }
        const result = parseGitCommand(cmd)
        assert.deepStrictEqual(result, { subCommand: 'rev-parse', subCommandArgs: ['HEAD'], mainArgs: [], cPath: undefined })
    })

    test('returns undefined when -C has no following arg', () => {
        const cmd: CommandNode = { command: 'git', args: ['-C'] }
        const result = parseGitCommand(cmd)
        // No sub-command found after -C, so returns undefined
        assert.strictEqual(result, undefined)
    })
})

suite('isInside', () => {
    test('returns true when child is inside parent', () => {
        assert.strictEqual(isInside('/Users/tamura/src/github/vscode-able/src', '/Users/tamura/src/github/vscode-able'), true)
    })

    test('returns true when paths are equal', () => {
        assert.strictEqual(isInside('/Users/tamura/src/github/vscode-able', '/Users/tamura/src/github/vscode-able'), true)
    })

    test('returns false when child is outside parent', () => {
        assert.strictEqual(isInside('/Users/tamura/src/github/other', '/Users/tamura/src/github/vscode-able'), false)
    })

    test('returns false when paths are siblings', () => {
        assert.strictEqual(isInside('/Users/tamura/src/github/vscode-able-a', '/Users/tamura/src/github/vscode-able'), false)
    })

    test('returns false for relative child path', () => {
        assert.strictEqual(isInside('relative/path', '/Users/tamura/src/github/vscode-able'), false)
    })

    test('returns false for relative parent path', () => {
        assert.strictEqual(isInside('/Users/tamura/src/github/vscode-able/src', 'relative/path'), false)
    })

    test('returns true for deeply nested child', () => {
        assert.strictEqual(isInside('/a/b/c/d/e', '/a/b'), true)
    })

    test('returns false when parent is inside child', () => {
        assert.strictEqual(isInside('/a/b', '/a/b/c/d/e'), false)
    })
})
