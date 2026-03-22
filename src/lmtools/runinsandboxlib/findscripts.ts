import type treeSitter from '#vscode-tree-sitter-wasm'
import { getNodeText, normalizeToken, bashParser, parserInitialization } from './commandparser.js'


type ScriptKind = 'python' | 'javascript' | 'bash'

interface ScriptNode {
    code: string
    kind: ScriptKind
}

export async function findScripts(source: string): Promise<ScriptNode[]> {
    await parserInitialization
    if (!bashParser) {
        return []
    }

    const tree = bashParser.parse(source)
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
