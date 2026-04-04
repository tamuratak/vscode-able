import { createRequire } from 'node:module'
import treeSitter from '#vscode-tree-sitter-wasm'
import { treeSitterParserInit } from '../treesitterinit.js'

const nodeRequire = createRequire(__filename)
const javascriptLanguagePath = nodeRequire.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter-javascript.wasm')

let parser: treeSitter.Parser | undefined
let javascriptLanguage: treeSitter.Language | undefined
let errorQuery: treeSitter.Query | undefined

const parserInitialization = ensureParserInitialized()

const forbiddenPropertyAccesses = new Map<string, string>([
    ['constructor', 'forbidden: constructor property access'],
    ['__proto__', 'forbidden: __proto__ property access'],
    ['__defineGetter__', 'forbidden: __defineGetter__ property access'],
    ['__defineSetter__', 'forbidden: __defineSetter__ property access'],
    ['__lookupGetter__', 'forbidden: __lookupGetter__ property access'],
    ['__lookupSetter__', 'forbidden: __lookupSetter__ property access']
])

const forbiddenSymbolProperties = new Map<string, string>([
    ['species', 'forbidden: Symbol.species reference'],
    ['hasInstance', 'forbidden: Symbol.hasInstance reference']
])

async function ensureParserInitialized(): Promise<void> {
    await treeSitterParserInit
    javascriptLanguage = await treeSitter.Language.load(javascriptLanguagePath)
    parser = new treeSitter.Parser()
    parser.setLanguage(javascriptLanguage)
    errorQuery = new treeSitter.Query(javascriptLanguage, '(ERROR) @error')
}

export interface CodeValidationResult {
    ok: boolean
    reason?: string
}

export async function validatePlaywrightExecCode(code: string): Promise<CodeValidationResult> {
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

    const forbiddenPropertyAccessReason = detectForbiddenPropertyAccess(node, source)
    if (forbiddenPropertyAccessReason) {
        return forbiddenPropertyAccessReason
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

        const forbiddenCallReason = detectForbiddenCallExpression(node, functionNode, source)
        if (forbiddenCallReason) {
            return forbiddenCallReason
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

function detectForbiddenPropertyAccess(node: treeSitter.Node, source: string): string | undefined {
    if (node.type !== 'member_expression' && node.type !== 'subscript_expression') {
        return undefined
    }

    const objectNode = node.childForFieldName('object')
    const propertyNode = node.childForFieldName('property') ?? node.childForFieldName('index')
    if (!objectNode || !propertyNode) {
        return undefined
    }

    const propertyName = getPropertyName(propertyNode, source)
    if (!propertyName) {
        return undefined
    }

    const forbiddenPropertyReason = forbiddenPropertyAccesses.get(propertyName)
    if (forbiddenPropertyReason) {
        return forbiddenPropertyReason
    }

    const objectName = getSimpleIdentifier(objectNode, source)
    if (objectName === 'Symbol') {
        const forbiddenSymbolReason = forbiddenSymbolProperties.get(propertyName)
        if (forbiddenSymbolReason) {
            return forbiddenSymbolReason
        }
    }

    return undefined
}

function detectForbiddenCallExpression(node: treeSitter.Node, functionNode: treeSitter.Node, source: string): string | undefined {
    if (functionNode.type !== 'member_expression' && functionNode.type !== 'subscript_expression') {
        return undefined
    }

    const objectNode = functionNode.childForFieldName('object')
    const propertyNode = functionNode.childForFieldName('property') ?? functionNode.childForFieldName('index')
    if (!objectNode || !propertyNode) {
        return undefined
    }

    const objectName = getSimpleIdentifier(objectNode, source)
    const propertyName = getPropertyName(propertyNode, source)
    if (!propertyName) {
        return undefined
    }

    if ((objectName === 'Object' || objectName === 'Reflect') && propertyName === 'setPrototypeOf') {
        return 'forbidden: setPrototypeOf call'
    }

    if ((objectName === 'Object' || objectName === 'Reflect') && propertyName === 'defineProperty') {
        const argumentsNode = node.childForFieldName('arguments')
        const firstArgument = argumentsNode?.namedChild(0)
        if (firstArgument) {
            const firstArgumentText = getNodeText(firstArgument, source).trim()
            if (firstArgumentText === 'Object.prototype') {
                return 'forbidden: Object.prototype defineProperty call'
            }
        }
    }

    return undefined
}

function getSimpleIdentifier(node: treeSitter.Node, source: string): string | undefined {
    if (node.type === 'identifier') {
        return getNodeText(node, source)
    }
    return undefined
}

function getPropertyName(node: treeSitter.Node, source: string): string | undefined {
    if (node.type === 'property_identifier' || node.type === 'identifier') {
        return getNodeText(node, source)
    }

    if (node.type === 'string') {
        return getStringLiteralValue(getNodeText(node, source))
    }

    if (node.type === 'template_string') {
        return getTemplateStringValue(getNodeText(node, source))
    }

    return undefined
}

function getStringLiteralValue(value: string): string | undefined {
    if (value.length < 2) {
        return undefined
    }

    const quote = value[0]
    const isQuoted = (quote === '"' || quote === "'") && value[value.length - 1] === quote
    if (!isQuoted) {
        return undefined
    }

    return value.slice(1, value.length - 1)
}

function getTemplateStringValue(value: string): string | undefined {
    if (value.length < 2 || value[0] !== '`' || value[value.length - 1] !== '`') {
        return undefined
    }

    const body = value.slice(1, value.length - 1)
    if (body.includes('${')) {
        return undefined
    }

    return body
}
