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
(variable_assignment) @assignment
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
    // Start index of the nearest ancestor `pipeline` node. Commands in the
    // same pipeline share the same id, which lets the validator identify the
    // command feeding stdin (e.g. `git diff ... | git apply -R`).
    pipelineId?: number
    // True when the command has an explicit stdin redirect (`<`, `<<`, `<<<`)
    // attached to itself or to an ancestor (e.g. the pipeline it belongs to).
    // Such a redirect overrides the stdin supplied by a pipeline.
    stdinRedirected?: boolean
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

    try {
        const matches = commandQuery.matches(tree.rootNode)
        // Reject lines that assign environment variables (e.g. GIT_PAGER=x git log),
        // which can alter command behavior (arbitrary pager/diff execution, repo redirect).
        // Plain shell variable assignments (e.g. `x=1; echo hi`) are also rejected
        // intentionally: a standalone assignment cannot be distinguished from an env
        // var prefix at the token level, and over-blocking is safer than allowing it.
        if (matches.some(m => m.captures.some(c => c.name === 'assignment'))) {
            return undefined
        }
        const commands: CommandNode[] = []
        const commandMap = new Map<number, CommandNode>()

        for (const match of matches) {
            let commandName: string | undefined
            let commandStartIndex: number | undefined
            let pipelineStartIndex: number | undefined
            let stdinRedirected: boolean | undefined
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
                        stdinRedirected = hasStdinRedirect(node, source) || undefined
                        let ancestor: treeSitter.Node | null | undefined = node.parent
                        while (ancestor && ancestor.type !== 'pipeline') {
                            ancestor = ancestor.parent
                        }
                        if (ancestor) {
                            pipelineStartIndex = ancestor.startIndex
                        }
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
                    if (stdinRedirected) {
                        existing.stdinRedirected = true
                    }
                } else {
                    const entry: CommandNode = { command: commandName, args }
                    if (pipelineStartIndex !== undefined) {
                        entry.pipelineId = pipelineStartIndex
                    }
                    if (stdinRedirected !== undefined) {
                        entry.stdinRedirected = true
                    }
                    commandMap.set(commandStartIndex, entry)
                    commands.push(entry)
                }
            }
        }
        return commands
    } finally {
        tree.delete()
    }
}

/**
 * Returns true when the file_redirect node redirects stdin (`<`, `0<`, and
 * the fd duplication forms `<&` / `0<&`). Writes (`>`, `>>`, `>&`, `&>` ...)
 * and non-stdin FD redirects like `2<` are not stdin.
 */
function isStdinFileRedirect(node: treeSitter.Node, source: string): boolean {
    if (node.type !== 'file_redirect') {
        return false
    }
    const fd = node.children.find(ch => ch?.type === 'file_descriptor')
    if (fd && getNodeText(fd, source) !== '0') {
        return false
    }
    for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (!child) {
            continue
        }
        if (child.type === '<' || child.type === '<&') {
            return true
        }
    }
    return false
}

/**
 * Returns true when the command (or an ancestor such as the pipeline it
 * belongs to) has an explicit stdin redirect: `file_redirect` with `<`
 * (`<&` fd duplication included), `heredoc_redirect` (`<<`, including
 * explicit-FD forms like `0<<EOF` which keep the same node type) or
 * `herestring_redirect` (`<<<`). Bash lets such a redirect override the
 * stdin supplied by a pipe, so a piped command with its own stdin redirect
 * does not read from the pipe.
 */
function hasStdinRedirect(startNode: treeSitter.Node, source: string): boolean {
    let node: treeSitter.Node | null | undefined = startNode
    while (node) {
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i)
            if (!child) {
                continue
            }
            if (child.type === 'heredoc_redirect' || child.type === 'herestring_redirect') {
                return true
            }
            if (isStdinFileRedirect(child, source)) {
                return true
            }
        }
        node = node.parent
    }
    return false
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
    for (let i = 0; i < node.namedChildCount; i += 1) {
        const child = node.namedChild(i)
        if (!child || child.type === 'file_descriptor') {
            continue
        }
        return normalizeToken(getNodeText(child, source)) === '/dev/null'
    }
    return false
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
