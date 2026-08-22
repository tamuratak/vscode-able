import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { commandStartsWith, exactMatchCommand, isAllowedCommand, isInside, parseGitCommand } from '../../../../src/lmtools/runinsandboxlib/validator.js'
import type { CommandNode } from '../../../../src/lmtools/runinsandboxlib/commandparser.js'

suite('validator', () => {
    test('allows cd + nl + sed pipeline without file argument', async () => {
        const cmd = "cd /Users/tamura/src/github/vscode-copilot-chat && nl -ba src/extension/prompts/node/inline/inlineChatFix3Prompt.tsx | sed -n '60,120p'"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows cd + nl + sed -n \'730,780p; 880,960p; 1500,1680p\'', async () => {
        const cmd = "cd /Users/tamura/src/github/vscode-copilot-chat && nl -ba src/vs/base/browser/ui/list/listView.ts | sed -n '730,780p; 880,960p; 1500,1680p'"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allow cd /Users/tamura/src/github/vscode-copilot-chat && rg -n "visibility" src/vs/workbench/contrib/chat/common/promptSyntax/service/promptsServiceImpl.ts', async () => {
        const cmd = 'cd /Users/tamura/src/github/vscode-copilot-chat && rg -n "visibility" src/vs/workbench/contrib/chat/common/promptSyntax/service/promptsServiceImpl.ts'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test("allow nl -ba /Users/tamura/src/github/vscode-copilot-chat/src/vs/workbench/contrib/chat/browser/widget/chatListRenderer.ts | sed -n '1390,1465p;2200,2335p'", async () => {
        const cmd = "nl -ba /Users/tamura/src/github/vscode-copilot-chat/src/vs/workbench/contrib/chat/browser/widget/chatListRenderer.ts | sed -n '1390,1465p;2200,2335p'"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test("allow cd /Users/tamura/src/github/vscode-copilot-chat && sed -n '2320,2395p' src/vs/workbench/api/common/extHost.protocol.ts | cat -n", async () => {
        const cmd = "cd /Users/tamura/src/github/vscode-copilot-chat && sed -n '2320,2395p' src/vs/workbench/api/common/extHost.protocol.ts | cat -n"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test("cd /Users/tamura/src/github/vscode && find src -maxdepth 2 -type f | sed -n '1,120p'", async () => {
        const cmd = "cd /Users/tamura/src/github/vscode-copilot-chat && find src -maxdepth 2 -type f | sed -n '1,120p'"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test("cd /Users/tamura/src/github/vscode && find src -exec evil -maxdepth 2 -type f | sed -n '1,120p'", async () => {
        const cmd = "cd /Users/tamura/src/github/vscode-copilot-chat && find src -exec evil -maxdepth 2 -type f | sed -n '1,120p'"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('find -fprint0 is disallowed', async () => {
        const cmd = 'find . -fprint0 out.txt'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test("allow sed -n '100,150p' /Users/tamura/src/github/vscode-copilot-chat/src/vs/workbench/contrib/chat/browser/widget/chatListRenderer.ts", async () => {
        const cmd = "sed -n '100,150p' /Users/tamura/src/github/vscode-copilot-chat/src/vs/workbench/contrib/chat/browser/widget/chatListRenderer.ts"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test("allow sed -n '/class LanguageModelDataPart {/,/^[[:space:]]*}/p' /path/to/file.d.ts", async () => {
        const cmd = "sed -n '/class LanguageModelDataPart {/,/^[[:space:]]*}/p' /Users/tamura/src/github/vscode-copilot-chat/node_modules/@types/vscode/index.d.ts"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test("allow sed -n '/pattern1/,/pattern2/p' /path/to/file", async () => {
        const cmd = "sed -n '/^import/,/^}/p' /Users/tamura/src/github/vscode-copilot-chat/src/main.ts"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test("allow sed -n '5,/pattern/p' (mixed numeric and regex address)", async () => {
        const cmd = "sed -n '5,/^}/p' /Users/tamura/src/github/vscode-copilot-chat/src/main.ts"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test("allow sed -n '/pattern/p' (single regex address)", async () => {
        const cmd = "sed -n '/^class/p' /Users/tamura/src/github/vscode-copilot-chat/src/main.ts"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test("allow sed -n '/pattern1/,/pattern2/p; 10,20p' (mixed regex and numeric ranges)", async () => {
        const cmd = "sed -n '/^class/,/^}/p; 10,20p' /Users/tamura/src/github/vscode-copilot-chat/src/main.ts"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('disallows sed \'/version/ W warn.log\' package.json', async () => {
        const cmd = "sed '/version/ W warn.log' package.json"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('cd out of workspace is disallowed', async () => {
        const cmd = 'cd /Users/tamura/src/github/vscode'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('sed -i is disallowed', async () => {
        const cmd = "sed -E -i.bak -e 's/old/new/g' -e '/^#/d' file"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('sed -I is disallowed', async () => {
        const cmd = "sed -E -Ibak -e 's/old/new/g' -e '/^#/d' file"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('sed w command writes to file and is disallowed', async () => {
        const cmd = "sed -n '/pattern/w outfile' infile"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('sed w command with numeric range is disallowed', async () => {
        const cmd = "sed -n '1,10w outfile' infile"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('sed w command without -n is disallowed', async () => {
        const cmd = "sed '/pattern/w outfile' infile"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('rg --pre is disallowed', async () => {
        const cmd = 'rg --pre \'sed s/foo/bar/g\' pattern'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('evil command is disallowed', async () => {
        const cmd = 'grep ; evil_command'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('evil command is disallowed', async () => {
        const cmd = 'evil_command'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('git status is allowed', async () => {
        const cmd = 'git status'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('git status -sb is allowed', async () => {
        const cmd = 'git status -sb'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('git -C /Users/tamura/src/github/vscode-copilot-chat --no-pager status -sb is allowed', async () => {
        const cmd = 'git -C /Users/tamura/src/github/vscode-copilot-chat --no-pager status -sb'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('git -C /Users/tamura/src/github/vscode --no-pager status -sb is disallowed', async () => {
        const cmd = 'git -C /Users/tamura/src/github/vscode --no-pager status -sb'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('git push is disallowed', async () => {
        const cmd = 'git push origin main'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('allows git diff <hash> -- <file> piped to git apply -R', async () => {
        const cmd = 'git diff 4c0e33c44aa -- README.md | git apply -R'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows git show <hash> piped to git apply -R', async () => {
        const cmd = 'git show 4c0e33c44aa | git apply -R'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows git --no-pager diff piped to git apply -R', async () => {
        const cmd = 'git --no-pager diff HEAD -- main.ts | git apply -R'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('disallows git apply -R without a pipe source', async () => {
        const cmd = 'git apply -R'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows echo piped to git apply -R', async () => {
        const cmd = 'echo x | git apply -R'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git apply -R with input redirection', async () => {
        const cmd = 'git apply -R < patch.diff'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git apply -R after semicolon (stdin is terminal)', async () => {
        const cmd = 'git diff HEAD -- main.ts; git apply -R'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git log -p piped to git apply -R (only diff/show are sources)', async () => {
        const cmd = 'git log -p HEAD | git apply -R'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git diff piped through sed to git apply -R', async () => {
        const cmd = "git diff HEAD -- main.ts | sed -n '1,10p' | git apply -R"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git apply -R with pipe and input redirection (overrides pipe)', async () => {
        const cmd = 'git diff HEAD -- main.ts | git apply -R < patch.diff'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git apply -R with pipe and heredoc (overrides pipe)', async () => {
        const cmd = "git diff HEAD -- main.ts | git apply -R <<'EOF'\npatch content\nEOF"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git apply -R with pipe and herestring (overrides pipe)', async () => {
        const cmd = 'git diff HEAD -- main.ts | git apply -R <<< patch'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('allows git apply -R after cd to workspace', async () => {
        const cmd = 'cd /Users/tamura/src/github/vscode-copilot-chat && git diff 4c0e33c44aa -- main.ts | git apply -R'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows git apply -R with -C workspace', async () => {
        const cmd = 'git diff 4c0e33c44aa -- main.ts | git -C /Users/tamura/src/github/vscode-copilot-chat apply -R'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('disallows git apply without -R', async () => {
        const cmd = 'git apply'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git apply --index', async () => {
        const cmd = 'git apply --index -R'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git apply --cached', async () => {
        const cmd = 'git apply --cached -R'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git apply -R --directory=..', async () => {
        const cmd = 'git apply -R --directory=..'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git apply -R -p1', async () => {
        const cmd = 'git apply -R -p1'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git apply -R --3way', async () => {
        const cmd = 'git apply -R --3way'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git apply -R with <&1 fd duplication', async () => {
        const cmd = 'git diff 4c0e33c44aa -- README.md | git apply -R <&1'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git apply -R with 0<&1 fd duplication', async () => {
        const cmd = 'git diff 4c0e33c44aa -- README.md | git apply -R 0<&1'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git apply -R with <> read-write redirect', async () => {
        const cmd = 'git apply -R <> patch'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git apply -R with pipe and <> redirect (overrides pipe)', async () => {
        const cmd = 'git diff HEAD -- main.ts | git apply -R <> patch'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows subshell with extra output piped to git apply -R (aggregated stdin)', async () => {
        const cmd = "(echo 'diff --git a/f b/f'; git diff HEAD) | git apply -R"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows group with extra output piped to git apply -R (aggregated stdin)', async () => {
        const cmd = "{ echo 'diff --git a/f b/f'; git diff HEAD; } | git apply -R"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows group with nested pipe output piped to git apply -R (aggregated stdin)', async () => {
        const cmd = "{ echo 'diff --git a/f b/f' | cat; git diff HEAD; } | git apply -R"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git diff inside a subshell as apply source', async () => {
        const cmd = '(git diff HEAD -- main.ts) | git apply -R'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('allows git diff with stderr redirect as apply source', async () => {
        const cmd = 'git diff HEAD -- main.ts 2>/dev/null | git apply -R'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('disallows git diff --no-index as apply source (writes/removes workspace files)', async () => {
        const cmd = 'git diff --no-index a b | git apply -R'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git diff --no-in as apply source (prefix expansion of --no-index)', async () => {
        const cmd = 'git diff --no-in a b | git apply -R'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git diff --no-inde as apply source (prefix expansion of --no-index)', async () => {
        const cmd = 'git diff --no-inde a b | git apply -R'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git diff --ext (prefix expansion of --ext-diff)', async () => {
        const cmd = 'git diff --ext HEAD'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git show --textconv (runs textconv filters)', async () => {
        const cmd = 'git show --textconv HEAD:file.pdf'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git diff --textconv (runs textconv filters)', async () => {
        const cmd = 'git diff --textconv HEAD'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git diff --ext-diff (runs external diff driver)', async () => {
        const cmd = 'git diff --ext-diff HEAD'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git log --textconv (runs textconv filters)', async () => {
        const cmd = 'git log --textconv HEAD'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git blame --textconv (runs textconv filters)', async () => {
        const cmd = 'git blame --textconv file.txt'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git diff --textc (prefix expansion of --textconv)', async () => {
        const cmd = 'git diff --textc HEAD'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git diff --ext-d (prefix expansion of --ext-diff)', async () => {
        const cmd = 'git diff --ext-d HEAD'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git show --textc (prefix expansion of --textconv)', async () => {
        const cmd = 'git show --textc HEAD:file.pdf'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git log --textc (prefix expansion of --textconv)', async () => {
        const cmd = 'git log --textc HEAD'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git blame --textc (prefix expansion of --textconv)', async () => {
        const cmd = 'git blame --textc file.txt'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git blame --text (prefix expansion of --textconv, blame has no --text)', async () => {
        const cmd = 'git blame --text file.txt'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('allows git diff --text HEAD (log/diff/show have their own --text option)', async () => {
        const cmd = 'git diff --text HEAD'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows git log --text -1 (log has its own --text option)', async () => {
        const cmd = 'git log --text -1'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('disallows git grep --no-i (prefix expansion of --no-index)', async () => {
        const cmd = 'git grep --no-i foo /etc/passwd'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git grep --out= (prefix expansion of --output=)', async () => {
        const cmd = 'git grep --out=/tmp/out foo'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git grep --open-files-in-p= (prefix expansion of --open-files-in-pager)', async () => {
        const cmd = 'git grep --open-files-in-p=/bin/sh foo'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('allows git grep --no-color (prefix does not match denied options)', async () => {
        const cmd = 'git grep --no-color foo'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('disallows git cat-file --fi (prefix expansion of --filters)', async () => {
        const cmd = 'git cat-file --fi blob HEAD:file'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git cat-file --f (prefix expansion of --filters)', async () => {
        const cmd = 'git cat-file --f blob HEAD:file'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git cat-file --textc (prefix expansion of --textconv)', async () => {
        const cmd = 'git cat-file --textc blob HEAD:file.txt'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git cat-file --text (prefix expansion of --textconv)', async () => {
        const cmd = 'git cat-file --text blob HEAD:file.txt'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git cat-file --pa= (prefix expansion of --path)', async () => {
        const cmd = 'git cat-file --pa=x blob HEAD'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git cat-file --p (prefix expansion of --path)', async () => {
        const cmd = 'git cat-file --p blob HEAD'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git cat-file --batch-co (prefix expansion of --batch-command)', async () => {
        const cmd = 'git cat-file --batch-co'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('allows git cat-file --batch (not expanded to --batch-command)', async () => {
        const cmd = 'git cat-file --batch'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('disallows git diff piped to git apply -R inside a group (shares stdin)', async () => {
        const cmd = 'git diff HEAD -- main.ts | { git apply -R; }'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git diff piped to git apply -R inside a subshell', async () => {
        const cmd = 'git diff HEAD -- main.ts | (git apply -R)'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('allows git cat-file -p <hash>', async () => {
        const cmd = 'git cat-file -p 4c0e33c44aa'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows git cat-file -t <hash>', async () => {
        const cmd = 'git cat-file -t 4c0e33c44aa'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows git cat-file <type> <hash>', async () => {
        const cmd = 'git cat-file commit 4c0e33c44aa'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows git cat-file -p with -C workspace', async () => {
        const cmd = 'git -C /Users/tamura/src/github/vscode-copilot-chat cat-file -p 4c0e33c44aa'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('disallows git cat-file --filters (runs smudge/clean scripts)', async () => {
        const cmd = 'git cat-file --filters --path=src/main.ts 4c0e33c44aa'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git cat-file --textconv (runs textconv scripts)', async () => {
        const cmd = 'git cat-file --textconv --path=file.txt 4c0e33c44aa'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git cat-file --filters=<...> (defensive)', async () => {
        const cmd = 'git cat-file --filters=foo 4c0e33c44aa'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git cat-file --textconv=<...> (defensive)', async () => {
        const cmd = 'git cat-file --textconv=foo 4c0e33c44aa'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git cat-file --path with plain arg', async () => {
        const cmd = 'git cat-file --path=src/main.ts blob 4c0e33c44aa'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git cat-file --batch-command (can create objects)', async () => {
        const cmd = 'git cat-file --batch-command'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git cat-file --batch-command=<format>', async () => {
        const cmd = 'git cat-file --batch-command=%(objectname)'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git grep with env var prefix', async () => {
        const cmd = 'GIT_PAGER=/bin/sh git grep foo'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git diff with GIT_EXTERNAL_DIFF env var prefix', async () => {
        const cmd = 'GIT_EXTERNAL_DIFF=/bin/sh git diff HEAD'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows cd followed by env var prefix in pipeline', async () => {
        const cmd = 'cd /Users/tamura/src/github/vscode-copilot-chat && GIT_PAGER=/bin/sh git log'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('allows git grep -n <pattern>', async () => {
        const cmd = 'git grep -n foo'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows git grep --cached <pattern>', async () => {
        const cmd = 'git grep --cached foo'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows git grep with -C workspace', async () => {
        const cmd = 'git -C /Users/tamura/src/github/vscode-copilot-chat grep -l foo'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('disallows git grep --open-files-in-pager (runs pager)', async () => {
        const cmd = 'git grep --open-files-in-pager foo'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git grep --open-files-in-pager=<pager>', async () => {
        const cmd = 'git grep --open-files-in-pager=less foo'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git grep -O (runs pager)', async () => {
        const cmd = 'git grep -O foo'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git grep -nO/bin/sh (clustered -O runs arbitrary pager)', async () => {
        const cmd = 'git grep -nO/bin/sh foo'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git grep --output=<file> (writes matches)', async () => {
        const cmd = 'git grep --output=/tmp/out foo'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git grep --textconv (runs textconv filters)', async () => {
        const cmd = 'git grep --textconv foo'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git grep --text (prefix expansion of --textconv)', async () => {
        const cmd = 'git grep --text foo'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git grep -inOless (clustered -O runs pager)', async () => {
        const cmd = 'git grep -inOless foo'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('allows git grep -nE (clustered -E is safe)', async () => {
        const cmd = 'git grep -nE foo'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('disallows git grep --no-index (searches arbitrary paths)', async () => {
        const cmd = 'git grep --no-index foo /etc/passwd'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git diff --output=<file> (writes to arbitrary path)', async () => {
        const cmd = 'git diff --output=/tmp/out HEAD'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git log --output=<file>', async () => {
        const cmd = 'git log --output=/tmp/out HEAD'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows git show --output <file>', async () => {
        const cmd = 'git show --output /tmp/out 4c0e33c44aa'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('allows git diff --output-indicator-new=+ (not a write)', async () => {
        const cmd = 'git diff --output-indicator-new=+ HEAD'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows git ls-tree HEAD', async () => {
        const cmd = 'git ls-tree HEAD'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows git ls-tree -r --name-only HEAD src', async () => {
        const cmd = 'git ls-tree -r --name-only HEAD src'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows git ls-files', async () => {
        const cmd = 'git ls-files'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows git ls-files --stage', async () => {
        const cmd = 'git ls-files --stage src'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows git rev-list --count HEAD', async () => {
        const cmd = 'git rev-list --count HEAD'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows git rev-list --all --oneline', async () => {
        const cmd = 'git rev-list --all --oneline'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows git describe', async () => {
        const cmd = 'git describe --tags'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows git name-rev HEAD', async () => {
        const cmd = 'git name-rev HEAD'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows git shortlog -sn', async () => {
        const cmd = 'git shortlog -sn --all'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows git count-objects -vH', async () => {
        const cmd = 'git count-objects -vH'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('head command is allowed', async () => {
        const cmd = 'cat a.txt | head -n 10'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('shell expansion is disallowed', async () => {
        const cmd = 'grep $(evil_command)'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('shell expansion is disallowed', async () => {
        const cmd = 'grep `evil_command`'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('shell expansion is disallowed', async () => {
        const cmd = 'grep ~/date'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('allows git show with ~ revision syntax', async () => {
        const cmd = 'cd /Users/tamura/src/github/vscode && git show 4c0e33c44aa~1:src/vs/workbench/contrib/chat/browser/widget/chatListRenderer.ts'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode'])
        assert.strictEqual(ok, true)
    })

    test('allows git show with ~ revision syntax piped to grep and head', async () => {
        const cmd = "cd /Users/tamura/src/github/vscode && git show 4c0e33c44aa~1:src/vs/workbench/contrib/chat/browser/widget/chatListRenderer.ts | grep -n 'renderChatResponseBasic|getNextProgressiveRenderContent|codeCitations|errorDetails|changesSummary|turnPills|workingProgress|partsToRender|content.push' | head -60"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode'])
        assert.strictEqual(ok, true)
    })

    test('allows git show with HEAD~1 syntax', async () => {
        const cmd = 'git show HEAD~1:src/main.ts'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode'])
        assert.strictEqual(ok, true)
    })

    test('disallows tilde expansion ~user/path in argument', async () => {
        const cmd = 'cat ~otheruser/file.txt'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode'])
        assert.strictEqual(ok, false)
    })

    test('disallows bare tilde as argument', async () => {
        const cmd = 'ls ~'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode'])
        assert.strictEqual(ok, false)
    })

    test(' > redirection is disallowed', async () => {
        const cmd = 'echo aaa > a.txt'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test(' > redirection is disallowed', async () => {
        const cmd = `# Loop that overwrites the file each iteration
for i in 1 2 3; do
  # Overwrite file with current index
  echo "current: $i" > current.txt
done`
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('allows cat append heredoc to root planexec.md after cd to workspace root', async () => {
        const cmd = `cd /Users/tamura/src/github/lean4-examples/ex01 && cat >> planexec.md <<'EOF'

- 2026-03-28: update note
EOF`
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/lean4-examples/ex01'])
        assert.strictEqual(ok, true)
    })

    test('allows cat append heredoc to root plan.md after cd to workspace root', async () => {
        const cmd = `cd /Users/tamura/src/github/lean4-examples/ex01 && cat >> plan.md <<'EOF'

- 2026-03-28: update note
EOF`
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/lean4-examples/ex01'])
        assert.strictEqual(ok, true)
    })

    test('allows cat append heredoc to root memo.md after cd to workspace root', async () => {
        const cmd = `cd /Users/tamura/src/github/lean4-examples/ex01 && cat >> memo.md <<'EOF'

- 2026-03-28: update note
EOF`
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/lean4-examples/ex01'])
        assert.strictEqual(ok, true)
    })

    test('disallows cat append heredoc to non-whitelisted file', async () => {
        const cmd = `cd /Users/tamura/src/github/lean4-examples/ex01 && cat >> notes.md <<'EOF'

- 2026-03-28: update note
EOF`
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/lean4-examples/ex01'])
        assert.strictEqual(ok, false)
    })

    test('disallows relative append target when not anchored by cd to workspace root', async () => {
        const cmd = `cat >> plan.md <<'EOF'

- 2026-03-28: update note
EOF`
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/lean4-examples/ex01'])
        assert.strictEqual(ok, false)
    })

    test('allows > redirection to /dev/null', async () => {
        const cmd = 'echo hello > /dev/null'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows rg with > /dev/null redirection', async () => {
        const cmd = 'rg pattern file.txt > /dev/null'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows 2>&1 with > /dev/null redirection', async () => {
        const cmd = 'rg pattern file.txt > /dev/null 2>&1'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows 2> /dev/null redirection', async () => {
        const cmd = 'ls 2>/dev/null'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('disallows > redirection to regular file even with /dev/null', async () => {
        const cmd = 'echo hello > output.txt > /dev/null'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows >> redirection to regular file even with /dev/null', async () => {
        const cmd = 'echo hello >> output.txt > /dev/null'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows >& redirection to regular file even with /dev/null', async () => {
        const cmd = 'echo hello >& output.txt > /dev/null'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows >& redirection to regular file even with /dev/null', async () => {
        const cmd = 'echo hello >& output.txt 2 > /dev/null'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    // node -e tests
    test('allows node -e with safe code', async () => {
        const cmd = 'node -e \'console.log("hello")\''
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows node -e with safe expressions', async () => {
        const cmd = 'node -e \'const x = 1 + 2; console.log(x)\''
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('disallows node -e with require("fs")', async () => {
        const cmd = 'node -e \'require("fs")\''
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows node -e with process access', async () => {
        const cmd = 'node -e \'process.exit()\''
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows node -e with variable assignment from forbidden module', async () => {
        const cmd = 'node -e \'const fs = require("fs"); fs.readFileSync("/etc/passwd")\''
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows node without args', async () => {
        const cmd = 'node'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows node -e without script argument', async () => {
        const cmd = 'node -e'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows node --eval', async () => {
        const cmd = 'node --eval \'console.log("hello")\''
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows node -e with extra arguments', async () => {
        const cmd = 'node -e \'console.log("hello")\' extra_arg'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('allows cd + node -e with safe code', async () => {
        const cmd = 'cd /Users/tamura/src/github/vscode-copilot-chat && node -e \'console.log("hello")\''
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('disallows node -e with import("fs")', async () => {
        const cmd = 'node -e \'import("fs").then(m => m.readFileSync("/etc/passwd"))\''
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows node -e with eval', async () => {
        const cmd = 'node -e \'eval("process.exit()")\''
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows node -e with require and non-literal argument', async () => {
        const cmd = 'node -e \'const m = "fs"; require(m).readFileSync("/etc/passwd")\''
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows node -e with template literal require', async () => {
        const cmd = 'node -e \'require(`fs`)\''
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows node -e with template literal import', async () => {
        const cmd = 'node -e \'import(`fs`)\''
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows node -e with require("https")', async () => {
        const cmd = 'node -e \'require("https")\''
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows 2> redirection to file', async () => {
        const cmd = 'rg pattern file.txt 2> error.log'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows &> redirection to file', async () => {
        const cmd = 'rg pattern file.txt &> output.txt'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })


    test('disallows >| redirection to file', async () => {
        const cmd = 'echo hello >| output.txt'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    // multi-root workspace tests
    test('allows cd to the second workspace root', async () => {
        const cmd = 'cd /Users/tamura/src/github/vscode-able && ls src'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat', '/Users/tamura/src/github/vscode-able'])
        assert.strictEqual(ok, true)
    })

    test('allows cd to the first workspace root in multi-root', async () => {
        const cmd = 'cd /Users/tamura/src/github/vscode-copilot-chat && ls src'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat', '/Users/tamura/src/github/vscode-able'])
        assert.strictEqual(ok, true)
    })

    test('disallows cd to non-workspace path in multi-root', async () => {
        const cmd = 'cd /Users/tamura/src/github/other && ls'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat', '/Users/tamura/src/github/vscode-able'])
        assert.strictEqual(ok, false)
    })

    test('allows git -C to the second workspace root in multi-root', async () => {
        const cmd = 'git -C /Users/tamura/src/github/vscode-able status'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat', '/Users/tamura/src/github/vscode-able'])
        assert.strictEqual(ok, true)
    })

    test('disallows git -C to non-workspace path in multi-root', async () => {
        const cmd = 'git -C /Users/tamura/src/github/other status'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat', '/Users/tamura/src/github/vscode-able'])
        assert.strictEqual(ok, false)
    })

    test('allows command with undefined workspaceRootPaths', async () => {
        const cmd = 'ls src'
        const ok = await isAllowedCommand(cmd, undefined)
        assert.strictEqual(ok, true)
    })

    // man command tests
    test('allows man <name>', async () => {
        const cmd = 'man jq'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows man <name> with hyphen', async () => {
        const cmd = 'man git-config'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows man <name> with underscore', async () => {
        const cmd = 'man __func__'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('disallows man with no arguments', async () => {
        const cmd = 'man'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows man with two arguments', async () => {
        const cmd = 'man 1 printf'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows man -P pager', async () => {
        const cmd = 'man -P less jq'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows man with flag argument', async () => {
        const cmd = 'man -w jq'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows man with path separator in argument', async () => {
        const cmd = 'man ../../../etc/passwd'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows man with dot in argument', async () => {
        const cmd = 'man file.conf'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows man with argument starting with hyphen', async () => {
        const cmd = 'man -evil'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    // sort tests
    test('allows sort', async () => {
        const cmd = 'echo -e "b\\na" | sort'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows sort with flags', async () => {
        const cmd = 'echo -e "b\\na" | sort -r'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows sort -n -u', async () => {
        const cmd = 'echo -e "2\\n1" | sort -n -u'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('disallows sort -o (output to file)', async () => {
        const cmd = 'sort -o output.txt input.txt'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows sort -S (buffer size)', async () => {
        const cmd = 'sort -S 1G input.txt'
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    // sed substitution tests
    test('disallows sed s/pattern/replacement/ file.txt', async () => {
        const cmd = "sed 's/old/new/' file.txt"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows sed s/pattern/replacement/g file.txt', async () => {
        const cmd = "sed 's/old/new/g' file.txt"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('allows sed s/pattern/replacement/gi', async () => {
        const cmd = "echo 'Hello World' | sed 's/hello/hi/gi'"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows sed s/.*fix: //', async () => {
        const cmd = "echo 'fix: bug' | sed 's/.*fix: //'"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('allows sed s/empty replacement/', async () => {
        const cmd = "echo 'remove-this' | sed 's/remove-this//'"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, true)
    })

    test('disallows sed s/pattern/replacement/p (p flag not allowed)', async () => {
        const cmd = "sed 's/old/new/p' file.txt"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows sed s/pattern/replacement/w (w flag writes to file)', async () => {
        const cmd = "sed 's/old/new/w outfile' file.txt"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows sed with multiple substitutions', async () => {
        const cmd = "echo 'abc' | sed 's/a/x/;s/b/y/'"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows sed non-substitution command (d)', async () => {
        const cmd = "sed '1,5d' file.txt"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    test('disallows sed with pipe delimiter', async () => {
        const cmd = "sed 's|old|new|' file.txt"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode-copilot-chat'])
        assert.strictEqual(ok, false)
    })

    // pipeline with sort and sed substitution
    test('allows git log piped through sed substitution, sort, and head', async () => {
        const cmd = "cd /Users/tamura/src/github/vscode && git log --oneline | sed 's/^[a-f0-9]* //' | sort | head -60"
        const ok = await isAllowedCommand(cmd, ['/Users/tamura/src/github/vscode'])
        assert.strictEqual(ok, true)
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

    test('parses git apply -R', () => {
        const cmd: CommandNode = { command: 'git', args: ['apply', '-R'] }
        const result = parseGitCommand(cmd)
        assert.deepStrictEqual(result, { subCommand: 'apply', subCommandArgs: ['-R'], mainArgs: [], cPath: undefined })
    })

    test('parses git cat-file -p', () => {
        const cmd: CommandNode = { command: 'git', args: ['cat-file', '-p', '4c0e33c44aa'] }
        const result = parseGitCommand(cmd)
        assert.deepStrictEqual(result, { subCommand: 'cat-file', subCommandArgs: ['-p', '4c0e33c44aa'], mainArgs: [], cPath: undefined })
    })

    test('parses git grep', () => {
        const cmd: CommandNode = { command: 'git', args: ['grep', '-n', 'foo'] }
        const result = parseGitCommand(cmd)
        assert.deepStrictEqual(result, { subCommand: 'grep', subCommandArgs: ['-n', 'foo'], mainArgs: [], cPath: undefined })
    })

    test('parses git ls-tree', () => {
        const cmd: CommandNode = { command: 'git', args: ['ls-tree', 'HEAD'] }
        const result = parseGitCommand(cmd)
        assert.deepStrictEqual(result, { subCommand: 'ls-tree', subCommandArgs: ['HEAD'], mainArgs: [], cPath: undefined })
    })

    test('parses git ls-files', () => {
        const cmd: CommandNode = { command: 'git', args: ['ls-files'] }
        const result = parseGitCommand(cmd)
        assert.deepStrictEqual(result, { subCommand: 'ls-files', subCommandArgs: [], mainArgs: [], cPath: undefined })
    })

    test('parses git rev-list', () => {
        const cmd: CommandNode = { command: 'git', args: ['rev-list', '--count', 'HEAD'] }
        const result = parseGitCommand(cmd)
        assert.deepStrictEqual(result, { subCommand: 'rev-list', subCommandArgs: ['--count', 'HEAD'], mainArgs: [], cPath: undefined })
    })

    test('parses git describe', () => {
        const cmd: CommandNode = { command: 'git', args: ['describe', '--tags'] }
        const result = parseGitCommand(cmd)
        assert.deepStrictEqual(result, { subCommand: 'describe', subCommandArgs: ['--tags'], mainArgs: [], cPath: undefined })
    })

    test('parses git name-rev', () => {
        const cmd: CommandNode = { command: 'git', args: ['name-rev', 'HEAD'] }
        const result = parseGitCommand(cmd)
        assert.deepStrictEqual(result, { subCommand: 'name-rev', subCommandArgs: ['HEAD'], mainArgs: [], cPath: undefined })
    })

    test('parses git shortlog', () => {
        const cmd: CommandNode = { command: 'git', args: ['shortlog', '-sn'] }
        const result = parseGitCommand(cmd)
        assert.deepStrictEqual(result, { subCommand: 'shortlog', subCommandArgs: ['-sn'], mainArgs: [], cPath: undefined })
    })

    test('parses git count-objects', () => {
        const cmd: CommandNode = { command: 'git', args: ['count-objects', '-v'] }
        const result = parseGitCommand(cmd)
        assert.deepStrictEqual(result, { subCommand: 'count-objects', subCommandArgs: ['-v'], mainArgs: [], cPath: undefined })
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
