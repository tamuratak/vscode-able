import path from 'node:path'
import { collectCommands, CommandNode, hasNoWriteRedirection } from './commandparser.js'

const forbiddenCharacters = /[~]/
const allowedCommands = new Set(['cat', 'cd', 'echo', 'head', 'ls', 'nl', 'rg', 'sed', 'tail', 'grep'])

export async function isAllowedCommand(command: string, workspaceRootPath: string | undefined): Promise<boolean> {
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

        if (isAllowedSubCommand(cmd)) {
            continue
        }

        if (!allowedCommands.has(cmd.command)) {
            return false
        }

        if (cmd.command === 'sed') {
            if (cmd.args.length >= 2) {
                const last = cmd.args[cmd.args.length - 1]
                if (isPotentialFilenameForSed(last)) {
                    return false
                }
            }
            for (const arg of cmd.args) {
                if (/^-[iI]\b/.test(arg)) {
                    return false
                }
            }
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

function isAllowedSubCommand(command: CommandNode): boolean {
    if (matchCli(['git', 'status'], [command.command, ...command.args])) {
        return true
    }

    if (matchCli(['git', 'status', /^(-[sb]+)?$/], [command.command, ...command.args])) {
        return true
    }

    return false
}

function isPotentialFilenameForSed(token: string): boolean {
    if (token.length === 0) {
        return false
    }
    if (token.startsWith('-')) {
        return false
    }

    if (/^s\/.+\/.+\/[a-z]*$/.test(token)) {
        return false
    }

    if (/^\d+,\d+.(;\s\d+,\d+.)*$/.test(token) || /^\d+p$/.test(token)) {
        return false
    }

    return true
}

function matchCli(pattern: (string | RegExp)[], input: string[]): boolean {
    if (pattern.length !== input.length) {
        return false
    }
    for (let i = 0; i < pattern.length; i++) {
        const p = pattern[i]
        const inp = input[i]
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
