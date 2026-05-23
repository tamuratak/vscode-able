import { createRequire } from 'node:module'
import treeSitter from '#vscode-tree-sitter-wasm'
import { treeSitterParserInit } from '../../treesitterinit.js'

const nodeRequire = createRequire(__filename)
// const treeSitterWasmPath = nodeRequire.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm')
const bashLanguagePath = nodeRequire.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter-bash.wasm')
const commandQuerySource = `(command
    name: (command_name (word)) @cmd_name
    argument: (_) @arg
 )
(command
    name: (command_name (word)) @cmd_name
)
`

export let bashParser: treeSitter.Parser | undefined
let commandQuery: treeSitter.Query | undefined
let bashLanguage: treeSitter.Language | undefined
export const parserInitialization = (async () => {
    try {
        await treeSitterParserInit
        bashLanguage = await treeSitter.Language.load(bashLanguagePath)
        bashParser = new treeSitter.Parser()
        bashParser.setLanguage(bashLanguage)
        commandQuery = new treeSitter.Query(bashLanguage, commandQuerySource)
    } catch (error) {
        console.error('Failed to initialize command parser:', error)
    }
})()

export interface CommandNode {
    command: string
    args: string[]
}

export async function collectCommands(source: string): Promise<CommandNode[] | undefined> {
    await parserInitialization
    if (!bashParser || !commandQuery) {
        return undefined
    }

    const tree = bashParser.parse(source)
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

export function getNodeText(node: treeSitter.Node, source: string): string {
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


const redirectQuerySource = '(file_redirect) @redirect'
let redirectQuery: treeSitter.Query | undefined

function isWriteRedirect(node: treeSitter.Node): boolean {
    for (let i = 0; i < node.childCount; i += 1) {
        const child = node.child(i)
        if (!child || child.isNamed) {
            continue
        }
        if (child.type === '>' || child.type === '>>' || child.type === '&>' || child.type === '&>>' || child.type === '>|') {
            return true
        }
        // >& writes to a file when the target is a word, not a number (FD duplication like 2>&1)
        if (child.type === '>&') {
            if (node.children.find(ch => ch?.type === 'word')) {
                return true
            }
        }
    }
    return false
}

function isRedirectToDevNull(node: treeSitter.Node, source: string): boolean {
    const targetNode = node.namedChild(0)
    if (!targetNode) {
        return false
    }
    return normalizeToken(getNodeText(targetNode, source)) === '/dev/null'
}

export async function hasNoWriteRedirection(source: string): Promise<boolean> {
    await parserInitialization
    if (!bashParser || !bashLanguage) {
        return false
    }
    if (!redirectQuery) {
        redirectQuery = new treeSitter.Query(bashLanguage, redirectQuerySource)
    }

    const tree = bashParser.parse(source)
    if (!tree) {
        return false
    }

    try {
        const matches = redirectQuery.matches(tree.rootNode)
        for (const match of matches) {
            for (const capture of match.captures) {
                if (capture.name === 'redirect' && isWriteRedirect(capture.node)) {
                    if (!isRedirectToDevNull(capture.node, source)) {
                        return false
                    }
                }
            }
        }
        return true
    } finally {
        tree.delete()
    }
}
