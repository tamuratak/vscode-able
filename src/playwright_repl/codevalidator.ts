import { createRequire } from 'node:module'
import treeSitter from '#vscode-tree-sitter-wasm'
import { treeSitterParserInit } from '../treesitterinit.js'

const nodeRequire = createRequire(__filename)
const javascriptLanguagePath = nodeRequire.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter-javascript.wasm')

let parser: treeSitter.Parser | undefined
let javascriptLanguage: treeSitter.Language | undefined
let errorQuery: treeSitter.Query | undefined

const parserInitialization = ensureParserInitialized()

async function ensureParserInitialized(): Promise<void> {
    await treeSitterParserInit.promise
    javascriptLanguage = await treeSitter.Language.load(javascriptLanguagePath)
    parser = new treeSitter.Parser()
    parser.setLanguage(javascriptLanguage)
    errorQuery = new treeSitter.Query(javascriptLanguage, '(ERROR) @error')
}

export interface CodeValidationResult {
    ok: boolean
    reason?: string
}

export async function validatePlaywrightReplCode(code: string): Promise<CodeValidationResult> {
    await parserInitialization
    if (!parser || !errorQuery) {
        return { ok: false, reason: 'failed to initialize parser' }
    }

    const trimmed = code.trim()
    if (trimmed.length === 0) {
        return { ok: false, reason: 'code is empty' }
    }

    const tree = parser.parse(trimmed)
    if (!tree) {
        return { ok: false, reason: 'failed to parse code' }
    }

    try {
        const errors = errorQuery.matches(tree.rootNode)
        if (errors.length > 0) {
            return { ok: false, reason: 'syntax error detected by tree-sitter' }
        }

        const forbiddenReason = findForbiddenNode(tree.rootNode, trimmed)
        if (forbiddenReason) {
            return { ok: false, reason: forbiddenReason }
        }
    } finally {
        tree.delete()
    }

    return { ok: true }
}

function findForbiddenNode(rootNode: treeSitter.Node, source: string): string | undefined {
    const stack: treeSitter.Node[] = [rootNode]

    while (stack.length > 0) {
        const node = stack.pop()
        if (!node) {
            continue
        }

        const forbiddenReason = detectForbiddenNode(node, source)
        if (forbiddenReason) {
            return forbiddenReason
        }

        for (let i = node.childCount - 1; i >= 0; i -= 1) {
            const child = node.child(i)
            if (child) {
                stack.push(child)
            }
        }
    }

    return undefined
}

function detectForbiddenNode(node: treeSitter.Node, source: string): string | undefined {
    if (node.type === 'import_statement') {
        return 'forbidden: import statement'
    }

    if (node.type === 'call_expression') {
        const functionNode = node.childForFieldName('function')
        if (!functionNode) {
            return undefined
        }

        if (functionNode.type === 'import') {
            return 'forbidden: dynamic import call'
        }

        if (functionNode.type === 'identifier') {
            const functionName = getNodeText(functionNode, source)
            if (functionName === 'require') {
                return 'forbidden: require call'
            }
        }
    }

    if (node.type === 'member_expression') {
        const objectNode = node.childForFieldName('object')
        const propertyNode = node.childForFieldName('property')
        if (!objectNode || !propertyNode) {
            return undefined
        }

        const objectText = getNodeText(objectNode, source)
        const propertyText = getNodeText(propertyNode, source)

        if (objectText === 'process') {
            return 'forbidden: process reference'
        }
        if (objectText === 'globalThis' && propertyText === 'process') {
            return 'forbidden: globalThis.process reference'
        }
    }

    return undefined
}

function getNodeText(node: treeSitter.Node, source: string): string {
    return source.slice(node.startIndex, node.endIndex)
}
