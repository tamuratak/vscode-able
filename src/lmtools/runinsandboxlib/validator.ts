import path from 'node:path'
import fs from 'node:fs/promises'
import { collectCommands, CommandNode, hasNoWriteRedirection } from './commandparser.js'
import { validateNodeScript } from './nodevalidate.js'
import { isAllowedPlanAppendCommand } from './validatorlib/redirect.js'


export async function isAllowedCommand(command: string, workspaceRootPaths: string[] | undefined): Promise<boolean> {
    // File redirection
    const allowPlanAppend = await isAllowedPlanAppendCommand(command, workspaceRootPaths)
    if (!allowPlanAppend && !await hasNoWriteRedirection(command)) {
        return false
    }

    const commands = await collectCommands(command)
    if (commands === undefined) {
        return false
    }

    const normalizedWorkspaceRoots = workspaceRootPaths?.map(p => path.normalize(p)) ?? []

    for (let i = 0; i < commands.length; i++) {
        const cmd = commands[i]
        for (const arg of cmd.args) {
            if (arg.includes('settings.json')) {
                return false
            }
            // Block tilde expansion (e.g. ~/path, ~user/path) but allow ~ in the
            // middle of a token such as git revision syntax (HEAD~1, abc123~1:file).
            // Note: VAR=~user assignments are not caught here because the full
            // token starts with 'V', not '~'. This is acceptable because env/export
            // are blocked by isConfirmationRequired.
            if (arg.startsWith('~')) {
                return false
            }
        }

        // Unsafe commands that require confirmation
        if (isConfirmationRequired(cmd)) {
            return false
        }

        // Sub-commands
        if (await isAllowedSubCommand(cmd, normalizedWorkspaceRoots, getPipeSource(commands, i))) {
            continue
        }

        // node -e '...' with safe script
        if (cmd.command === 'node' && cmd.args.length === 2 && cmd.args[0] === '-e') {
            const result = await validateNodeScript(cmd.args[1])
            if (result.ok) {
                continue
            }
        }

        const allowedCommands = new Set(['cat', 'cd', 'echo', 'head', 'ls', 'nl', 'col', 'rg', 'jq', 'man', 'printf', 'sed', 'sort', 'tail', 'grep', 'find', 'pwd', 'wc', 'true', 'sleep', 'tr'])
        if (!allowedCommands.has(cmd.command)) {
            return false
        }

        if (cmd.command === 'sed') {
            const args = cmd.args
            const addr = '(?:\\d+|/[^/]+?/)'
            const rangeRegex = new RegExp(`^${addr}(?:,${addr})?p(?:;\\s*${addr}(?:,${addr})?p)*$`)
            if (args.length === 2 || args.length === 3) {
                const [first, second] = args
                if (first === '-n' && rangeRegex.test(second)) {
                    continue
                }
            }
            // Allow simple substitution: s/pattern/replacement/[gi]
            if (args.length === 1) {
                const substitutionRegex = /^s\/[^/]*\/[^/]*\/[gi]*$/
                if (substitutionRegex.test(args[0])) {
                    continue
                }
            }
            return false
        } else if (cmd.command === 'man') {
            // Only allow `man <name>` where <name> is a valid command name
            if (cmd.args.length !== 1) {
                return false
            }
            const commandNameRegex = /^[a-zA-Z0-9_][a-zA-Z0-9_-]*$/
            if (!commandNameRegex.test(cmd.args[0])) {
                return false
            }
        } else if (cmd.command === 'cd') {
            if (cmd.args.length !== 1) {
                return false
            }
            const target = path.normalize(cmd.args[0])
            if (normalizedWorkspaceRoots.length === 0 || !normalizedWorkspaceRoots.some(r => isInside(target, r))) {
                return false
            }
        }
    }

    return true
}

const validGitSubCommandNames = ['status', 'log', 'diff', 'show', 'blame', 'rev-parse',
    'apply', 'cat-file', 'grep', 'ls-tree', 'ls-files', 'rev-list',
    'describe', 'name-rev', 'shortlog', 'count-objects']
const validGitSubCommandsRegex = new RegExp(`^(?:${validGitSubCommandNames.join('|')})$`)

/**
 * Returns the command that feeds stdin to `commands[index]` through a pipe.
 * Only the immediate predecessor is considered: a compound statement
 * (`{ a | b; }`) placed between the source and the command aggregates the
 * stdout of everything inside it into the pipeline segment, so a source
 * further back is not what the command actually reads. Returns undefined
 * when the command is not in a pipeline, is its first command, or its
 * predecessor belongs to a nested pipeline (the compound case above) - in
 * those cases stdin is the terminal, a file redirect, a heredoc, or
 * aggregated compound output (all refused).
 */
function getPipeSource(commands: CommandNode[], index: number): CommandNode | undefined {
    const cmd = commands[index]
    if (cmd.pipelineId === undefined) {
        return undefined
    }
    const prev = commands[index - 1]
    if (prev && prev.pipelineId === cmd.pipelineId) {
        return prev
    }
    return undefined
}

async function isAllowedSubCommand(
    command: CommandNode,
    normalizedWorkspaceRoots: string[],
    pipeSource: CommandNode | undefined
): Promise<boolean> {
    if (command.command === 'git') {
        const gitCmd = parseGitCommand(command)
        if (gitCmd && gitCmd.subCommand && validGitSubCommandsRegex.test(gitCmd.subCommand)) {
            // `git shortlog` without arguments reads from stdin instead of a
            // revision range (it would hang waiting for input).
            if (gitCmd.subCommand === 'shortlog' && gitCmd.subCommandArgs.length === 0) {
                return false
            }
            // `--output[=<file>]` writes command output to an arbitrary path
            // (git diff/log/show support it), bypassing the sandbox write
            // restrictions. Reject it for every sub-command. The bare `--output`
            // and `--output=` are matched so diff-specific `--output-indicator-*`
            // options stay allowed.
            if (gitCmd.subCommandArgs.some(arg => arg === '--output' || arg.startsWith('--output='))) {
                return false
            }
            // `--textconv` / `--ext-diff` on log/diff/show/blame run user- or
            // gitattributes-configured external programs (the same class of
            // arbitrary command execution as the GIT_EXTERNAL_DIFF env var
            // already rejected above). git expands unambiguous long-option
            // prefixes, so reject the shortest unique prefixes: `--ext` ->
            // --ext-diff (no other --ext* option exists there); `--textc` ->
            // --textconv on log/diff/show (they have their own `--text`
            // option, so `--text` is ambiguous and errors out there), while
            // blame has no `--text` option of its own, so `--text` alone
            // already resolves to --textconv.
            if (['log', 'diff', 'show', 'blame'].includes(gitCmd.subCommand) &&
                gitCmd.subCommandArgs.some(arg => arg.startsWith('--ext') ||
                    (gitCmd.subCommand === 'blame' ? arg.startsWith('--text') : arg.startsWith('--textc')))) {
                return false
            }
            if (gitCmd.subCommand === 'apply' && !isAllowedGitApply(gitCmd, pipeSource, command)) {
                return false
            }
            if (gitCmd.subCommand === 'cat-file' && !isAllowedGitCatFile(gitCmd)) {
                return false
            }
            if (gitCmd.subCommand === 'grep' && !isAllowedGitGrep(gitCmd)) {
                return false
            }
            const cpath = gitCmd.cPath
            if (cpath) {
                if (path.isAbsolute(cpath) && normalizedWorkspaceRoots.some(r => isInside(cpath, r))) {
                    return true
                }
            } else {
                return true
            }
        }
    } else if (commandStartsWith(['lake', 'env', 'lean'], command) && normalizedWorkspaceRoots.length > 0) {
        // Lean 4's `lake env lean ./tmpdir/example.lean`
        if (command.args.length === 3) {
            const fileArg = command.args[2]
            for (const root of normalizedWorkspaceRoots) {
                const fileArgPath = path.normalize(path.join(root, fileArg))
                const tmpDirPath = path.normalize(path.join(root, './tmpdir'))
                if (path.dirname(fileArgPath) === tmpDirPath) {
                    try {
                        const fileContent = await fs.readFile(fileArgPath, 'utf-8')
                        if (/\bIO\b/.test(fileContent) || /\bSystem\b/.test(fileContent)) {
                            return false
                        } else {
                            return true
                        }
                    } catch {
                        return false
                    }
                }
            }
        }
    }
    return false
}

interface GitCommandInfo {
    subCommand: string
    subCommandArgs: string[]
    mainArgs: string[]
    cPath: string | undefined
}

export function parseGitCommand(command: CommandNode): GitCommandInfo | undefined {
    if (command.command !== 'git') {
        return
    }
    const mainArgs: string[] = []
    let cPath: string | undefined = undefined
    for (let i = 0; i < command.args.length; i++) {
        if (validGitSubCommandsRegex.exec(command.args[i])) {
            return { subCommand: command.args[i], subCommandArgs: command.args.slice(i + 1), mainArgs, cPath }
        } else if (command.args[i] === '-C') {
            cPath = command.args[i + 1]
            i += 1
        } else if (command.args[i] === '--no-pager') {
            mainArgs.push(command.args[i])
        } else {
            return
        }
    }
    return
}

/**
 * Validates `git apply` so it can only reverse-apply a patch to the working
 * tree (e.g. `git diff <hash> -- <path> | git apply -R`). Only `-R` with no
 * other arguments is allowed:
 * - `--index` / `--cached` would mutate the git index (rejected)
 * - `--directory`, `-p`, `--whitespace` etc. could redirect or rewrite the
 *   patch application (rejected)
 *
 * The patch must arrive through a pipe from `git diff` or `git show`, so the
 * content is generated by git itself instead of arbitrary input: an
 * `echo <patch> | git apply -R` or `git apply -R < file` would let the caller
 * rewrite any workspace file whose content matches the patch's old side.
 * In particular a stdin redirect attached to the apply command itself
 * (`git diff ... | git apply -R < patch`) overrides the pipe, so any form
 * of `<`, `<<`, `<<<` on the command is rejected.
 *
 * The pipe source must be a direct element of the pipeline: a compound
 * statement (subshell/group/loop) aggregates the stdout of every command
 * inside it, so `(echo <patch>; git diff HEAD) | git apply -R` would feed
 * attacker content plus git's output, and git apply applies every patch it
 * finds. `--no-index` is rejected as well - compared against /dev/null it
 * produces new-file patches whose reverse deletes the working tree file;
 * shorter prefixes of it (`--no-in`, ...) are rejected too because git
 * expands unambiguous long-option prefixes, and which prefix is unambiguous
 * depends on the git version's option set.
 *
 * The apply command itself must also be a direct element of the pipeline:
 * placed inside a group or subshell (`git diff HEAD | { cat; git apply -R; }`)
 * it shares stdin with sibling commands instead of receiving the pipe alone.
 *
 * Reverse-applying a diff touches only the working tree, never `.git`, so
 * this restores files without needing any seatbelt carve-out for `.git`.
 * Note that it does not update the index: staged changes stay staged even
 * when the working tree file is reverted.
 */
function isAllowedGitApply(gitCmd: GitCommandInfo, pipeSource: CommandNode | undefined, command: CommandNode): boolean {
    const args = gitCmd.subCommandArgs
    if (args.length !== 1 || args[0] !== '-R') {
        return false
    }
    // An explicit stdin redirect (`<`, `<<`, `<<<`) overrides the stdin
    // supplied by the pipe, so `git diff ... | git apply -R < patch` would
    // feed arbitrary patch content to git apply. Reject it unconditionally.
    if (command.stdinRedirected) {
        return false
    }
    // The apply command itself must be a direct element of the pipeline too:
    // inside a group/subshell (`git diff HEAD | { cat; git apply -R; }`) it
    // shares stdin with sibling commands instead of receiving the pipe alone.
    if (command.directPipelineMember !== true) {
        return false
    }
    if (pipeSource === undefined) {
        return false
    }
    const source = parseGitCommand(pipeSource)
    if (source === undefined || (source.subCommand !== 'diff' && source.subCommand !== 'show')) {
        return false
    }
    // Refuse compound pipe sources: a subshell/group/loop aggregates the
    // stdout of everything inside it, so the source must be a plain git
    // command that is a direct element of the pipeline.
    if (pipeSource.directPipelineMember !== true) {
        return false
    }
    // `git diff --no-index <a> <b>` compares two arbitrary files (e.g.
    // /dev/null vs a workspace file yields a new-file patch whose reverse
    // deletes that file), escaping the "restore to a past commit" design.
    // git expands unambiguous long-option prefixes, so the whole --no-i*
    // family is rejected (`--no-index` and its longer prefixes always
    // resolve to --no-index; shorter ones like --no-in / --no-inde become
    // unambiguous when a competing option is not registered).
    if (source.subCommand === 'diff' && source.subCommandArgs.some(arg => arg.startsWith('--no-i'))) {
        return false
    }
    return true
}

/**
 * Validates `git cat-file` so it only reads git objects. All read forms are
 * allowed (`-t`, `-s`, `-e`, `-p`, `<type> <object>`, `--batch`, `--batch-check`).
 * Options with side effects are rejected:
 * - `--filters` / `--textconv` / `--path=<path>` run user-configured smudge,
 *   clean, or textconv scripts (arbitrary command execution)
 * - `--batch-command` can create objects via its `create` subcommand (writes)
 *
 * Unambiguous long-option prefixes are rejected too because git expands them
 * (`--f` -> --filters, `--text` -> --textconv, `--p` -> --path,
 * `--batch-co` -> --batch-command). The bare `--f` also blocks the harmless
 * read-only `--follow-symlinks`: over-blocking is intentional, because the
 * set of `--f*` options may grow in future git versions and following
 * symlinks has no use case here. If `--follow-symlinks` ever needs to be
 * allowed, reject only `--fi*` (the shortest unambiguous prefix of
 * --filters) and permit `--fo*`.
 */
function isAllowedGitCatFile(gitCmd: GitCommandInfo): boolean {
    for (const arg of gitCmd.subCommandArgs) {
        // `--batch-c` is ambiguous with `--batch-check` (git errors out), so
        // `--batch-co` is the shortest unambiguous prefix of --batch-command.
        if (arg.startsWith('--f') || arg.startsWith('--text') || arg.startsWith('--p') || arg.startsWith('--batch-co')) {
            return false
        }
    }
    return true
}

/**
 * Validates `git grep` so it only searches repository content. Options
 * that escape the repository or launch external programs are rejected:
 * - `--open-files-in-pager[=<pager>]` / `-O[<pager>]` open matches in a
 *   pager (user-configured `core.pager`) — arbitrary command execution
 * - `--output=<file>` writes matched lines to an arbitrary path (writes)
 * - `--textconv` runs user-configured textconv filters (arbitrary
 *   command execution)
 * - `--no-index` turns the search into a raw file search over arbitrary
 *   paths outside the repository (e.g. `/etc/passwd`)
 *
 * Unambiguous long-option prefixes are rejected too because git expands them
 * (`--no-i` -> --no-index, `--te` -> --textconv). The whole `--o` family is
 * rejected wholesale: git grep's only `--o*` options are `--output[=]`
 * (writes) and `--open-files-in-pager[=]` (runs a pager), and any
 * unambiguous shorter prefix of them (`--ou=` -> --output=, `--ope` ->
 * --open-files-in-pager) is expanded by git before we see the full name.
 *
 * `-O` is the only short option containing 'O', so clustering like
 * `-nO/path/to/pager` (which git parses as `-n -O /path/to/pager`) and
 * `-O/bin/sh` are rejected by scanning every single-dash token for 'O'.
 */
function isAllowedGitGrep(gitCmd: GitCommandInfo): boolean {
    for (const arg of gitCmd.subCommandArgs) {
        if (arg.startsWith('--o') || arg.startsWith('--te') || arg.startsWith('--no-i')) {
            return false
        }
        if (arg.startsWith('-') && !arg.startsWith('--') && arg.slice(1).includes('O')) {
            return false
        }
    }
    return true
}

//
// https://github.com/microsoft/vscode/blob/698d618f29e978c2ca7f45570d148e6eb9aa2a66/src/vs/workbench/contrib/terminalContrib/chatAgentTools/common/terminalChatAgentToolsConfiguration.ts#L240
//
function isConfirmationRequired(command: CommandNode): boolean {
    const needConfirmationCommands = new Set([
        'rm', 'rmdir', 'mv', 'cp', 'chmod', 'chown',
        'dd', 'mkfs', 'mount', 'umount', 'ln', 'touch', 'truncate',
        'kill', 'pkill', 'ps', 'top', 'htop',
        'xargs', 'eval', 'nohup', 'sudo', 'env', 'export', 'nice', 'renice', 'watch', 'time', 'timeout',
        'shutdown', 'reboot', 'sysctl',
        'tee'
    ])

    if (needConfirmationCommands.has(command.command)) {
        return true
    }

    const needConfirmationPatterns: [string, RegExp][] = [
        ['date', /^(-s|--set)\b/],
        ['rg', /^--(pre|hostname-bin)\b/],
        ['find', /^-(delete|exec|execdir|fprint(?:0)?|fprintf|fls|ok|okdir)\b/],
        ['sed', /^(-[a-zA-Z]*(e|i|I|f)[a-zA-Z]*|--expression|--file|--in-place)\b/],
        ['sort', /^-(o|S)\b/],
        ['tree', /^-o\b/],
    ]
    for (const [cmd, pattern] of needConfirmationPatterns) {
        if (partialMatchCommand([cmd, pattern], command)) {
            return true
        }
    }

    if (partialMatchCommand(['column', /^-c\b/], command)) {
        if (command.args.find((arg) => /[0-9]{4,}/.test(arg))) {
            return true
        }
    }

    return false
}

/**
 * Returns true if the input command exactly matches the given pattern.
 */
export function exactMatchCommand(pattern: (string | RegExp)[], command: CommandNode): boolean {
    if (pattern.length !== command.args.length + 1) {
        return false
    }
    return commandStartsWith(pattern, command)
}

/**
 * Returns true if the input command starts with the given pattern.
 */
export function commandStartsWith(pattern: (string | RegExp)[], command: CommandNode): boolean {
    if (pattern[0] !== command.command) {
        return false
    }
    for (let i = 1; i < pattern.length; i++) {
        const p = pattern[i]
        const inp = command.args[i - 1]
        if (typeof p === 'string') {
            if (p !== inp) {
                return false
            }
        } else {
            if (!p.test(inp)) {
                return false
            }
        }
    }
    return true
}

/**
 * Returns true if one of the arguments matches some pattern.
 * Used to find unsafe arguments and options in the command.
 */
function partialMatchCommand(pattern: (string | RegExp)[], command: CommandNode): boolean {
    if (pattern[0] !== command.command) {
        return false
    }
    const argPatterns = pattern.slice(1)
    return !!argPatterns.find((pat) => {
        for (const arg of command.args) {
            if (typeof pat === 'string') {
                if (pat === arg) {
                    return true
                }
            } else {
                if (pat.test(arg)) {
                    return true
                }
            }
        }
        return false
    })
}

export function isInside(childPath: string, parentPath: string): boolean {
    if (!path.isAbsolute(childPath) || !path.isAbsolute(parentPath)) {
        return false
    }
    const absoluteChild = path.resolve(childPath)
    const absoluteParent = path.resolve(parentPath)
    if (absoluteChild === absoluteParent) {
        return true
    }
    const relative = path.relative(absoluteParent, absoluteChild)
    return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative)
}
