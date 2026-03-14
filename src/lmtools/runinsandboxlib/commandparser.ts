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

let parser: treeSitter.Parser | undefined
let commandQuery: treeSitter.Query | undefined
let bashLanguage: treeSitter.Language | undefined
const parserInitialization = ensureParserInitialized()

async function ensureParserInitialized(): Promise<void> {
    try {
        await treeSitterParserInit.promise
        bashLanguage = await treeSitter.Language.load(bashLanguagePath)
        parser = new treeSitter.Parser()
        parser.setLanguage(bashLanguage)
        commandQuery = new treeSitter.Query(bashLanguage, commandQuerySource)
    } catch (error) {
        console.error('Failed to initialize command parser:', error)
    }
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

type ScriptKind = 'python' | 'javascript' | 'bash'

interface ScriptNode {
    code: string
    kind: ScriptKind
}

export async function findScripts(source: string): Promise<ScriptNode[]> {
    await parserInitialization
    if (!parser) {
        return []
    }

    const tree = parser.parse(source)
    if (!tree) {
        return []
    }

    const scripts: ScriptNode[] = []

    try {
        collectInlineScripts(tree.rootNode, source, scripts)
        collectHeredocScripts(tree.rootNode, source, scripts)
        return scripts
    } finally {
        tree.delete()
    }
}

function collectInlineScripts(node: treeSitter.Node, source: string, scripts: ScriptNode[]): void {
    if (node.type === 'command') {
        const commandInfo = parseCommand(node, source)
        if (commandInfo) {
            const script = extractInlineScript(commandInfo.kind, commandInfo.args)
            if (script) {
                scripts.push({ code: script, kind: commandInfo.kind })
            }
        }
    }

    for (let i = 0; i < node.namedChildCount; i += 1) {
        const child = node.namedChild(i)
        if (child) {
            collectInlineScripts(child, source, scripts)
        }
    }
}

function collectHeredocScripts(node: treeSitter.Node, source: string, scripts: ScriptNode[]): void {
    if (node.type === 'redirected_statement') {
        const body = node.childForFieldName('body')
        if (body && body.type === 'command') {
            const commandInfo = parseCommand(body, source)
            if (commandInfo) {
                for (let i = 0; i < node.namedChildCount; i += 1) {
                    const child = node.namedChild(i)
                    if (!child || child.type !== 'heredoc_redirect') {
                        continue
                    }

                    for (let j = 0; j < child.namedChildCount; j += 1) {
                        const heredocChild = child.namedChild(j)
                        if (!heredocChild || heredocChild.type !== 'heredoc_body') {
                            continue
                        }

                        const code = source.slice(heredocChild.startIndex, heredocChild.endIndex)
                        if (code.trim().length > 0) {
                            scripts.push({ code, kind: commandInfo.kind })
                        }
                    }
                }
            }
        }
    }

    for (let i = 0; i < node.namedChildCount; i += 1) {
        const child = node.namedChild(i)
        if (child) {
            collectHeredocScripts(child, source, scripts)
        }
    }
}

function parseCommand(node: treeSitter.Node, source: string): { kind: ScriptKind, args: string[] } | undefined {
    const commandNameNode = node.childForFieldName('name')
    if (!commandNameNode) {
        return undefined
    }

    let commandWordNode: treeSitter.Node | undefined
    for (let i = 0; i < commandNameNode.namedChildCount; i += 1) {
        const child = commandNameNode.namedChild(i)
        if (child && child.type === 'word') {
            commandWordNode = child
            break
        }
    }
    if (!commandWordNode) {
        return undefined
    }

    const rawCommand = normalizeToken(getNodeText(commandWordNode, source)).toLowerCase()
    const kind = getScriptKind(rawCommand)
    if (!kind) {
        return undefined
    }

    const args: string[] = []
    for (let i = 0; i < node.namedChildCount; i += 1) {
        const child = node.namedChild(i)
        if (!child || child.type === 'command_name') {
            continue
        }
        const arg = normalizeToken(getNodeText(child, source))
        if (arg.length > 0) {
            args.push(arg)
        }
    }

    return { kind, args }
}

function getScriptKind(command: string): ScriptKind | undefined {
    if (command === 'python' || command === 'python3' || command === 'python2') {
        return 'python'
    }
    if (command === 'node' || command === 'nodejs' || command === 'deno') {
        return 'javascript'
    }
    if (command === 'bash' || command === 'sh' || command === 'zsh') {
        return 'bash'
    }
    return undefined
}

function extractInlineScript(kind: ScriptKind, args: string[]): string | undefined {
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i]

        if ((kind === 'python' || kind === 'bash') && arg === '-c') {
            return args[i + 1]
        }

        if (kind === 'javascript' && (arg === '-e' || arg === '--eval')) {
            return args[i + 1]
        }

        if (kind === 'javascript' && arg.startsWith('--eval=')) {
            return arg.slice('--eval='.length)
        }
    }

    return undefined
}
