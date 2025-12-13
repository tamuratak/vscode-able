import path from 'node:path'
import { createRequire } from 'node:module'
import treeSitter from '#vscode-tree-sitter-wasm'

const nodeRequire = createRequire(__filename)
const treeSitterWasmPath = nodeRequire.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm')
const bashLanguagePath = nodeRequire.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter-bash.wasm')
const commandQuerySource = `(command
    name: (command_name (word)) @cmd_name
    argument: (_) @arg
 )
(command
    name: (command_name (word)) @cmd_name
)`

let parser: treeSitter.Parser | undefined
let commandQuery: treeSitter.Query | undefined
let parserInitialization: Promise<void> | undefined

function ensureParserInitialized(): Promise<void> {
    if (!parserInitialization) {
        parserInitialization = (async () => {
            await treeSitter.Parser.init({ locateFile: () => treeSitterWasmPath })
            const language = await treeSitter.Language.load(bashLanguagePath)
            parser = new treeSitter.Parser()
            parser.setLanguage(language)
            commandQuery = new treeSitter.Query(language, commandQuerySource)
        })()
    }
    return parserInitialization
}

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

    await ensureParserInitialized()
    const commands = collectCommands(command)
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

interface CommandNode {
    command: string
    args: string[]
}

function collectCommands(source: string): CommandNode[] | null {
    if (!parser || !commandQuery) {
        return null
    }

    const tree = parser.parse(source)
    if (!tree) {
        return null
    }

    const matches = commandQuery.matches(tree.rootNode)
    const commands: CommandNode[] = []
    const commandMap = new Map<number, CommandNode>()

    for (const match of matches) {
        let commandName: string | undefined
        let commandStartIndex: number | undefined
        const args: string[] = []

        for (const capture of match.captures) {
            const text = normalizeToken(getNodeText(capture.node, source))
            if (capture.name === 'cmd_name') {
                commandName = text
                // identify the command node by walking to its ancestor 'command' node
                let node: treeSitter.Node | null | undefined = capture.node
                while (node && node.type !== 'command') {
                    node = node.parent
                }
                if (node) {
                    commandStartIndex = node.startIndex
                }
            } else if (capture.name === 'arg' && text.length > 0) {
                args.push(text)
            }
        }

        if (commandName && typeof commandStartIndex === 'number') {
            const existing = commandMap.get(commandStartIndex)
            if (existing) {
                for (const a of args) {
                    existing.args.push(a)
                }
            } else {
                const entry: CommandNode = { command: commandName, args }
                commandMap.set(commandStartIndex, entry)
                commands.push(entry)
            }
        }
    }

    tree.delete()
    return commands
}

function getNodeText(node: treeSitter.Node, source: string): string {
    return source.slice(node.startIndex, node.endIndex)
}

function normalizeToken(value: string): string {
    const trimmed = value.trim()
    if (trimmed.length >= 2) {
        const first = trimmed[0]
        const last = trimmed[trimmed.length - 1]
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            return unescapeQuotes(trimmed.slice(1, -1))
        }
    }
    return unescapeQuotes(trimmed)
}

function unescapeQuotes(value: string): string {
    return value
        .replace(/\\\n/g, '')
        .replace(/\\\\/g, '\\')
        .replace(/\\ /g, ' ')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
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
