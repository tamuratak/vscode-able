import path from 'node:path'
import fs from 'node:fs/promises'
import { collectCommands, CommandNode, hasNoWriteRedirection } from './commandparser.js'
import { validateNodeScript } from './nodevalidate.js'
import { isAllowedPlanAppendCommand } from './validatorlib/redirect.js'


export async function isAllowedCommand(command: string, workspaceRootPaths: string[] | undefined): Promise<boolean> {
    const forbiddenCharacters = /[~]/
    if (forbiddenCharacters.test(command)) {
        return false
    }

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

        const allowedCommands = new Set(['cat', 'cd', 'echo', 'head', 'ls', 'nl', 'col', 'rg', 'jq', 'man', 'printf', 'sed', 'tail', 'grep', 'find', 'pwd', 'wc', 'true', 'sleep'])
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

async function isAllowedSubCommand(
    command: CommandNode,
    normalizedWorkspaceRoots: string[]
): Promise<boolean> {
    if (command.command === 'git') {
        const validGitSubCommandsRegex = /^(status|log|diff|show|blame|rev-parse)$/
        const gitCmd = parseGitCommand(command)
        if (gitCmd && gitCmd.subCommand && validGitSubCommandsRegex.test(gitCmd.subCommand)) {
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
        if (/^(status|log|diff|show|blame|rev-parse)$/.exec(command.args[i])) {
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
        ['find', /^-(delete|exec|execdir|fprint|fprintf|fls|ok|okdir)\b/],
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
