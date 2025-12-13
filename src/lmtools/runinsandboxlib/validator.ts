import path from 'node:path'
import { collectCommands } from './treesittercommandparser.js'

const forbiddenCharacters = /[`();$<>~{}]/
const forbiddenKeywords = /\b(if|then|else|fi|for|while|do|done|case|esac|select|function)\b/
const bracketTest = /\s(\[|\[\[)\s/
const allowedCommands = new Set(['cd', 'head', 'tail', 'nl', 'sed', 'grep', 'rg'])

export async function isAllowedCommand(command: string, workspaceRootPath: string | undefined): Promise<boolean> {
    if (forbiddenCharacters.test(command)) {
        return false
    }

    if (forbiddenKeywords.test(command)) {
        return false
    }

    if (bracketTest.test(command)) {
        return false
    }

    const commands = await collectCommands(command)
    if (commands === null) {
        return false
    }

    const normalizedWorkspaceRoot = workspaceRootPath ? path.normalize(workspaceRootPath) : undefined

    for (const cmd of commands) {
        for (const arg of cmd.args) {
            if (arg.includes('settings.json')) {
                return false
            }
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

    if (/^\d+,\d+.$/.test(token) || /^\d+p$/.test(token)) {
        return false
    }

    return true
}
