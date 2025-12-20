
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
)
`

let parser: treeSitter.Parser | undefined
let commandQuery: treeSitter.Query | undefined
let bashLanguage: treeSitter.Language | undefined
const parserInitialization = ensureParserInitialized()

async function ensureParserInitialized(): Promise<void> {
    await treeSitter.Parser.init({ locateFile: () => treeSitterWasmPath })
    bashLanguage = await treeSitter.Language.load(bashLanguagePath)
    parser = new treeSitter.Parser()
    parser.setLanguage(bashLanguage)
    commandQuery = new treeSitter.Query(bashLanguage, commandQuerySource)
}

export interface CommandNode {
    command: string
    args: string[]
}

export async function collectCommands(source: string): Promise<CommandNode[] | undefined> {
    await parserInitialization
    if (!parser || !commandQuery) {
        return undefined
    }

    const tree = parser.parse(source)
    if (!tree) {
        return undefined
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

export function normalizeToken(value: string): string {
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


const redirectQuerySource = '(file_redirect ">") (file_redirect ">>")'
let readirectQuery: treeSitter.Query | undefined

export async function hasNoWriteRedirection(source: string): Promise<boolean> {
    await parserInitialization
    if (!parser || !bashLanguage) {
        return false
    }
    if (!readirectQuery) {
        readirectQuery = new treeSitter.Query(bashLanguage, redirectQuerySource)
    }

    const tree = parser.parse(source)
    if (!tree) {
        return false
    }

    try {
        const matches = readirectQuery.matches(tree.rootNode)
        if (matches.length === 0) {
            return true
        }
        return false
    } finally {
        tree.delete()
    }
}
