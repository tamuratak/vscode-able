import path from 'node:path'
import { parseCommand, ParsedCommand } from './commandparser.js'

// Check if a command string uses only allowed commands (cd, nl, sed),
// that no sed invocation includes a filename, and that no unquoted '>' is used.
// Returns true when the command is allowed under these constraints.
export function isAllowedCommand(command: string, workspaceRootPath: string | undefined): boolean {

    if (/[`()$<>~{}]/.test(command)) {
        return false
    }

    if (/\b(if|then|else|fi|for|while|do|done|case|esac|select|function)\b/.test(command)) {
        return false
    }

    if (/\s(\[|\[\[)\s/.test(command)) {
        return false
    }

    const parsed: ParsedCommand = parseCommand(command)
    const allowed = new Set(['cd', 'nl', 'sed', 'grep', 'rg'])

    for (const seq of parsed.sequences) {
        for (const cmd of seq.pipeline) {

            if (cmd.args.find(arg => arg.includes('settings.json'))) {
                return false
            }

            const name = cmd.command
            if (!allowed.has(name)) {
                return false
            }

            if (name === 'sed') {
                // Heuristic: treat presence of a non-option trailing argument
                // that does not look like a sed script as a filename.
                // If there are 2 or more args, check the last one.
                const args = cmd.args
                if (args.length >= 2) {
                    const last = args[args.length - 1]
                    if (isPotentialFilenameForSed(last)) {
                        return false
                    }
                }
            } else if (name === 'cd') {
                // check that the argument is within the workspace root
                if (cmd.args.length !== 1) {
                    return false
                }
                const target = cmd.args[0]
                const normalizedPath = path.normalize(target)
                if (!workspaceRootPath || !normalizedPath.startsWith(workspaceRootPath)) {
                    return false
                }
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

    // If token contains a slash or looks like a substitution script (s/...)
    // treat it as a script, not a filename
    if (token.includes('/')) {
        return false
    }
    if (/^s[^\s]*\/.+\/.+/.test(token)) {
        return false
    }

    // If the token looks like an address/script (e.g. 60,120p or 60p),
    // or contains a comma or sed command letter, treat it as a script
    if (/^[0-9,]+[a-zA-Z]?$/.test(token)) {
        return false
    }
    if (token.includes(',') || /[pdqsy]/.test(token)) {
        return false
    }

    // Otherwise consider it a filename
    return true
}
