import path from 'node:path'
import { collectCommands, CommandNode, hasNoWriteRedirection } from './commandparser.js'


export async function isAllowedCommand(command: string, workspaceRootPath: string | undefined): Promise<boolean> {
    const forbiddenCharacters = /[~]/
    if (forbiddenCharacters.test(command)) {
        return false
    }

    if (!await hasNoWriteRedirection(command)) {
        return false
    }

    const commands = await collectCommands(command)
    if (commands === undefined) {
        return false
    }

    const normalizedWorkspaceRoot = workspaceRootPath ? path.normalize(workspaceRootPath) : undefined

    for (const cmd of commands) {
        for (const arg of cmd.args) {
            if (arg.includes('settings.json')) {
                return false
            }
        }

        if (isConfirmationRequired(cmd)) {
            return false
        }

        if (isAllowedSubCommand(cmd, workspaceRootPath)) {
            continue
        }

        const allowedCommands = new Set(['cat', 'cd', 'echo', 'head', 'ls', 'nl', 'rg', 'printf', 'sed', 'tail', 'grep', 'pwd', 'wc', 'true'])
        if (!allowedCommands.has(cmd.command)) {
            return false
        }

        if (cmd.command === 'sed') {
            const args = cmd.args
            const rangeRegex = /^\d+,\d+.(;\s*\d+,\d+.)*$|^\d+p$/
            if (args.length === 2) {
                const [first, second] = args
                if (first === '-n' && rangeRegex.test(second)) {
                    continue
                }
            } else if (args.length === 3) {
                const [first, second] = args
                if (first === '-n' && rangeRegex.test(second)) {
                    continue
                }
            }
            return false
        } else if (cmd.command === 'cd') {
            if (cmd.args.length !== 1) {
                return false
            }
            const target = path.normalize(cmd.args[0])
            if (!normalizedWorkspaceRoot || !target.startsWith(normalizedWorkspaceRoot)) {
                return false
            }
        }
    }

    return true
}

function isAllowedSubCommand(command: CommandNode, workspaceRootPath: string | undefined): boolean {
    const validGitSubCommandsRegex = /^(status|log|diff|show|blame|rev-parse)$/
    if (commandStartsWith(['git', validGitSubCommandsRegex], command) || commandStartsWith(['git', '--no-pager', validGitSubCommandsRegex], command)) {
        return true
    } else if (commandStartsWith(['git', '-C', /.*/, '--no-pager', validGitSubCommandsRegex], command)) {
        const cpath = command.args[1]
        console.log(cpath)
        if (workspaceRootPath && path.isAbsolute(cpath) && isInside(cpath, workspaceRootPath)) {
            return true
        }
    }
    return false
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
 * Returns true if the input command starts with the given pattern.
 */
function commandStartsWith(pattern: (string | RegExp)[], command: CommandNode): boolean {
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

function isInside(childPath: string, parentPath: string): boolean {
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
