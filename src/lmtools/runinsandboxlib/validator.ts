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

    for (const cmd of commands) {
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
        if (await isAllowedSubCommand(cmd, normalizedWorkspaceRoots)) {
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

async function isAllowedSubCommand(
    command: CommandNode,
    normalizedWorkspaceRoots: string[]
): Promise<boolean> {
    if (command.command === 'git') {
        const gitCmd = parseGitCommand(command)
        if (gitCmd && gitCmd.subCommand && validGitSubCommandsRegex.test(gitCmd.subCommand)) {
            if (gitCmd.subCommand === 'apply' && !isAllowedGitApply(gitCmd)) {
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
 * Validates `git apply` so it can only reverse-apply a patch from stdin to
 * the working tree (e.g. `git diff <hash> -- <path> | git apply -R`). Only
 * `-R` with no other arguments is allowed:
 * - `--index` / `--cached` would mutate the git index (rejected)
 * - `--directory`, `-p`, `--whitespace` etc. could redirect or rewrite the
 *   patch application (rejected)
 *
 * Reverse-applying a diff touches only the working tree, never `.git`, so
 * this restores files without needing any seatbelt carve-out for `.git`.
 * Note that it does not update the index: staged changes stay staged even
 * when the working tree file is reverted. Patch contents arriving on stdin
 * are not validated here; the seatbelt denies writes outside the workspace.
 */
function isAllowedGitApply(gitCmd: GitCommandInfo): boolean {
    const args = gitCmd.subCommandArgs
    return args.length === 1 && args[0] === '-R'
}

/**
 * Validates `git cat-file` so it only reads git objects. All read forms are
 * allowed (`-t`, `-s`, `-e`, `-p`, `<type> <object>`, `--batch`, `--batch-check`).
 * Options with side effects are rejected:
 * - `--filters` / `--textconv` / `--path=<path>` run user-configured smudge,
 *   clean, or textconv scripts (arbitrary command execution)
 * - `--batch-command` can create objects via its `create` subcommand (writes)
 */
function isAllowedGitCatFile(gitCmd: GitCommandInfo): boolean {
    for (const arg of gitCmd.subCommandArgs) {
        if (arg === '--filters' || arg === '--textconv' || arg.startsWith('--batch-command') || arg.startsWith('--path')) {
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
 * - `--no-index` turns the search into a raw file search over arbitrary
 *   paths outside the repository (e.g. `/etc/passwd`)
 *
 * `-O` is the only short option containing 'O', so clustering like
 * `-nO/path/to/pager` (which git parses as `-n -O /path/to/pager`) and
 * `-O/bin/sh` are rejected by scanning every single-dash token for 'O'.
 */
function isAllowedGitGrep(gitCmd: GitCommandInfo): boolean {
    for (const arg of gitCmd.subCommandArgs) {
        if (arg === '--no-index') {
            return false
        }
        if (arg === '--open-files-in-pager' || arg.startsWith('--open-files-in-pager=')) {
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
