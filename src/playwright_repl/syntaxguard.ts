import { createRequire } from 'node:module'
import treeSitter from '#vscode-tree-sitter-wasm'

const nodeRequire = createRequire(__filename)
const treeSitterWasmPath = nodeRequire.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm')
const javascriptLanguagePath = nodeRequire.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter-javascript.wasm')

let parser: treeSitter.Parser | undefined

const parserInitialization = ensureParserInitialized()

async function ensureParserInitialized(): Promise<void> {
    await treeSitter.Parser.init({ locateFile: () => treeSitterWasmPath })
    const language = await treeSitter.Language.load(javascriptLanguagePath)
    parser = new treeSitter.Parser()
    parser.setLanguage(language)
}

export interface BannedSyntaxViolation {
    ruleid: string
    nodetype: string
    line: number
    column: number
    shortmessage: string
}

export async function findFirstBannedSyntax(source: string): Promise<BannedSyntaxViolation | undefined> {
    await parserInitialization
    if (!parser) {
        return {
            ruleid: 'guard.init_failed',
            nodetype: 'parser',
            line: 1,
            column: 1,
            shortmessage: 'syntax guard failed to initialize',
        }
    }

    const tree = parser.parse(source)
    if (!tree) {
        return {
            ruleid: 'guard.parse_failed',
            nodetype: 'parser',
            line: 1,
            column: 1,
            shortmessage: 'syntax guard failed to parse input',
        }
    }

    try {
        return inspectNode(tree.rootNode, source)
    } finally {
        tree.delete()
    }
}

function inspectNode(node: treeSitter.Node, source: string): BannedSyntaxViolation | undefined {
    const violation = detectViolation(node, source)
    if (violation) {
        return violation
    }

    for (let i = 0; i < node.namedChildCount; i += 1) {
        const child = node.namedChild(i)
        if (!child) {
            continue
        }
        const childViolation = inspectNode(child, source)
        if (childViolation) {
            return childViolation
        }
    }

    return undefined
}

function detectViolation(node: treeSitter.Node, source: string): BannedSyntaxViolation | undefined {
    if (node.type === 'import_statement' || node.type === 'import_clause') {
        return toViolation('import.statement', node, 'import declaration is not allowed')
    }

    if (node.type === 'meta_property') {
        const text = nodeText(node, source)
        if (text === 'import.meta') {
            return toViolation('import.meta', node, 'import.meta is not allowed')
        }
    }

    if (node.type === 'call_expression') {
        const fnNode = node.childForFieldName('function')
        if (fnNode) {
            const fnName = nodeText(fnNode, source)
            if (fnName === 'import') {
                return toViolation('import.dynamic', node, 'dynamic import is not allowed')
            }
            if (fnName === 'require') {
                return toViolation('require.call', node, 'require(...) is not allowed')
            }
            if (fnName === 'eval') {
                return toViolation('eval.call', node, 'eval(...) is not allowed')
            }
            if (fnName === 'setTimeout' || fnName === 'setInterval') {
                const argsNode = node.childForFieldName('arguments')
                const firstArg = argsNode?.namedChild(0)
                if (firstArg && isStringLike(firstArg.type)) {
                    return toViolation('timer.string', node, `${fnName}("...") is not allowed`)
                }
            }
        }
    }

    if (node.type === 'new_expression') {
        const ctorNode = node.childForFieldName('constructor')
        if (ctorNode && nodeText(ctorNode, source) === 'Function') {
            return toViolation('function.constructor', node, 'new Function(...) is not allowed')
        }
    }

    return undefined
}

function isStringLike(nodeType: string): boolean {
    return nodeType === 'string' || nodeType === 'template_string'
}

function nodeText(node: treeSitter.Node, source: string): string {
    return source.slice(node.startIndex, node.endIndex)
}

function toViolation(ruleid: string, node: treeSitter.Node, shortmessage: string): BannedSyntaxViolation {
    return {
        ruleid,
        nodetype: node.type,
        line: node.startPosition.row + 1,
        column: node.startPosition.column + 1,
        shortmessage,
    }
}
