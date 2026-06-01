import { createRequire } from 'node:module'
import treeSitter from '#vscode-tree-sitter-wasm'
import { treeSitterParserInit } from '../../treesitterinit.js'
import { getNodeText } from './commandparser.js'
import type { CodeValidationResult } from '../../playwright_exec/codevalidator.js'

const nodeRequire = createRequire(__filename)
const javascriptLanguagePath = nodeRequire.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter-javascript.wasm')

const forbiddenModules = new Set([
    'child_process',
    'fs',
    'net',
    'http',
    'https',
    'vm',
])

const forbiddenGlobals = new Set([
    'process',
    'globalThis',
    'global',
])

let parser: treeSitter.Parser | undefined
let javascriptLanguage: treeSitter.Language | undefined
let errorQuery: treeSitter.Query | undefined

const parserInitialization = ensureParserInitialized()

async function ensureParserInitialized(): Promise<void> {
    await treeSitterParserInit
    javascriptLanguage = await treeSitter.Language.load(javascriptLanguagePath)
    parser = new treeSitter.Parser()
    parser.setLanguage(javascriptLanguage)
    errorQuery = new treeSitter.Query(javascriptLanguage, '(ERROR) @error')
}

export async function validateNodeScript(code: string): Promise<CodeValidationResult> {
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
        return detectForbiddenImport(node, source)
    }

    if (node.type === 'call_expression') {
        const callReason = detectForbiddenCall(node, source)
        if (callReason) {
            return callReason
        }
    }

    if (node.type === 'new_expression') {
        const newReason = detectForbiddenNewExpression(node, source)
        if (newReason) {
            return newReason
        }
    }

    if (node.type === 'identifier') {
        const identifierText = getNodeText(node, source)
        if (forbiddenGlobals.has(identifierText)) {
            return `forbidden: ${identifierText} reference`
        }
    }

    if (node.type === 'member_expression' || node.type === 'subscript_expression') {
        const memberReason = detectForbiddenMemberAccess(node, source)
        if (memberReason) {
            return memberReason
        }
    }

    return undefined
}

function detectForbiddenImport(node: treeSitter.Node, source: string): string | undefined {
    const sourceNode = node.childForFieldName('source')
    if (sourceNode) {
        const moduleName = getStringOrTemplateLiteralValue(sourceNode, source)
        if (moduleName) {
            const normalized = moduleName.replace(/^node:/, '')
            if (forbiddenModules.has(normalized)) {
                return `forbidden: import from ${moduleName}`
            }
        }
    }
    return undefined
}

function detectForbiddenCall(node: treeSitter.Node, source: string): string | undefined {
    const functionNode = node.childForFieldName('function')
    if (!functionNode) {
        return undefined
    }

    // import("fs") or import(`fs`) - dynamic import
    if (functionNode.type === 'import') {
        const argsNode = node.childForFieldName('arguments')
        if (argsNode) {
            const firstArg = argsNode.namedChild(0)
            if (firstArg) {
                const moduleName = getStringOrTemplateLiteralValue(firstArg, source)
                if (moduleName) {
                    const normalized = moduleName.replace(/^node:/, '')
                    if (forbiddenModules.has(normalized)) {
                        return `forbidden: import('${moduleName}')`
                    }
                    return undefined
                }
            }
        }
        // Non-literal argument cannot be verified
        return 'forbidden: dynamic import with non-literal argument'
    }

    if (functionNode.type === 'identifier') {
        const functionName = getNodeText(functionNode, source)

        // require('fs') or require(`fs`)
        if (functionName === 'require') {
            const argsNode = node.childForFieldName('arguments')
            if (argsNode) {
                const firstArg = argsNode.namedChild(0)
                if (firstArg) {
                    const moduleName = getStringOrTemplateLiteralValue(firstArg, source)
                    if (moduleName) {
                        const normalized = moduleName.replace(/^node:/, '')
                        if (forbiddenModules.has(normalized)) {
                            return `forbidden: require('${moduleName}')`
                        }
                    } else {
                        return 'forbidden: require with non-literal argument'
                    }
                }
            }
        }

        // eval(...)
        if (functionName === 'eval') {
            return 'forbidden: eval call'
        }

        // Function(...)
        if (functionName === 'Function') {
            return 'forbidden: Function constructor call'
        }
    }

    return undefined
}

function detectForbiddenNewExpression(node: treeSitter.Node, source: string): string | undefined {
    const constructorNode = node.childForFieldName('constructor')
    if (constructorNode && constructorNode.type === 'identifier') {
        const constructorName = getNodeText(constructorNode, source)
        if (constructorName === 'Function') {
            return 'forbidden: new Function() call'
        }
    }
    return undefined
}

function detectForbiddenMemberAccess(node: treeSitter.Node, source: string): string | undefined {
    const objectNode = node.childForFieldName('object')
    const propertyNode = node.childForFieldName('property') ?? node.childForFieldName('index')
    if (!objectNode || !propertyNode) {
        return undefined
    }

    const objectText = getNodeText(objectNode, source)

    if (objectText === 'process') {
        return 'forbidden: process property access'
    }
    if (objectText === 'globalThis') {
        return 'forbidden: globalThis property access'
    }
    if (objectText === 'global') {
        return 'forbidden: global property access'
    }

    if (objectNode.type === 'identifier') {
        const forbiddenReason = checkVariableFromForbiddenModule(objectNode, source)
        if (forbiddenReason) {
            return forbiddenReason
        }
    }

    return undefined
}

function checkVariableFromForbiddenModule(identifierNode: treeSitter.Node, source: string): string | undefined {
    const variableName = getNodeText(identifierNode, source)

    let scopeNode: treeSitter.Node | null | undefined = identifierNode.parent
    while (scopeNode && scopeNode.type !== 'program' && scopeNode.type !== 'function_declaration' &&
        scopeNode.type !== 'arrow_function' && scopeNode.type !== 'function') {
        scopeNode = scopeNode.parent
    }

    if (!scopeNode) {
        return undefined
    }

    return findVariableAssignmentInScope(scopeNode, variableName, source)
}

function findVariableAssignmentInScope(scopeNode: treeSitter.Node, variableName: string, source: string): string | undefined {
    const stack: treeSitter.Node[] = [scopeNode]

    while (stack.length > 0) {
        const node = stack.pop()
        if (!node) {
            continue
        }

        if (node.type === 'variable_declaration' || node.type === 'lexical_declaration') {
            const declaration = node.namedChild(0)
            if (declaration) {
                const pattern = declaration.childForFieldName('name')
                const value = declaration.childForFieldName('value')

                if (pattern && value) {
                    // Simple assignment: const fs = require('fs')
                    if (pattern.type === 'identifier' && getNodeText(pattern, source) === variableName) {
                        const forbiddenModuleName = checkRequireCall(value, source)
                        if (forbiddenModuleName) {
                            return `forbidden: ${variableName} is from ${forbiddenModuleName}`
                        }
                    }

                    // Destructuring: const { readFile } = require('fs')
                    if (pattern.type === 'object_pattern' && value.type === 'call_expression') {
                        const functionNode = value.childForFieldName('function')
                        if (functionNode && functionNode.type === 'identifier' && getNodeText(functionNode, source) === 'require') {
                            const argsNode = value.childForFieldName('arguments')
                            if (argsNode) {
                                const firstArg = argsNode.namedChild(0)
                                if (firstArg) {
                                    const moduleName = getStringOrTemplateLiteralValue(firstArg, source)
                                    if (moduleName) {
                                        const normalized = moduleName.replace(/^node:/, '')
                                        if (forbiddenModules.has(normalized)) {
                                            if (isInDestructuringPattern(pattern, variableName, source)) {
                                                return `forbidden: ${variableName} destructured from ${moduleName}`
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        for (let i = node.namedChildCount - 1; i >= 0; i -= 1) {
            const child = node.namedChild(i)
            if (child) {
                stack.push(child)
            }
        }
    }

    return undefined
}

function checkRequireCall(node: treeSitter.Node, source: string): string | undefined {
    if (node.type !== 'call_expression') {
        return undefined
    }

    const functionNode = node.childForFieldName('function')
    if (!functionNode || functionNode.type !== 'identifier') {
        return undefined
    }

    const functionName = getNodeText(functionNode, source)
    if (functionName !== 'require') {
        return undefined
    }

    const argsNode = node.childForFieldName('arguments')
    if (!argsNode) {
        return undefined
    }

    const firstArg = argsNode.namedChild(0)
    if (firstArg) {
        const moduleName = getStringOrTemplateLiteralValue(firstArg, source)
        if (moduleName) {
            const normalized = moduleName.replace(/^node:/, '')
            if (forbiddenModules.has(normalized)) {
                return normalized
            }
        }
    }

    return undefined
}

function isInDestructuringPattern(patternNode: treeSitter.Node, variableName: string, source: string): boolean {
    if (patternNode.type === 'object_pattern') {
        for (let i = 0; i < patternNode.namedChildCount; i += 1) {
            const child = patternNode.namedChild(i)
            if (child && child.type === 'shorthand_property_identifier_pattern') {
                if (getNodeText(child, source) === variableName) {
                    return true
                }
            }
            if (child && child.type === 'pair_pattern') {
                const aliasValue = child.childForFieldName('value')
                if (aliasValue && aliasValue.type === 'identifier' && getNodeText(aliasValue, source) === variableName) {
                    return true
                }
            }
        }
    }

    if (patternNode.type === 'array_pattern') {
        for (let i = 0; i < patternNode.namedChildCount; i += 1) {
            const child = patternNode.namedChild(i)
            if (child && child.type === 'identifier') {
                if (getNodeText(child, source) === variableName) {
                    return true
                }
            }
        }
    }

    return false
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

function getStringOrTemplateLiteralValue(node: treeSitter.Node, source: string): string | undefined {
    if (node.type === 'string') {
        return getStringLiteralValue(getNodeText(node, source))
    }

    if (node.type === 'template_string') {
        // Reject template literals with interpolations
        for (let i = 0; i < node.namedChildCount; i += 1) {
            const child = node.namedChild(i)
            if (child && child.type === 'template_substitution') {
                return undefined
            }
        }
        // Simple template literal without interpolations - extract string_fragment
        const text = getNodeText(node, source)
        if (text.length < 2 || text[0] !== '`' || text[text.length - 1] !== '`') {
            return undefined
        }
        return text.slice(1, text.length - 1)
    }

    return undefined
}
