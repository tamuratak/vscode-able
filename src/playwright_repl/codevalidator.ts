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

const forbiddenPatterns = [
    /\bimport\s+.+from\s+['"].+['"]/,
    /\bimport\s*\(/,
    /\brequire\s*\(/,
    /\bchild_process\b/,
    /\bworker_threads\b/,
    /\bfs\b/,
    /\bnet\b/,
    /\btls\b/,
    /\bhttp\b/,
    /\bhttps\b/,
    /\bprocess\s*\./,
    /\bglobalThis\s*\.\s*process\b/
]

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

    for (const pattern of forbiddenPatterns) {
        if (pattern.test(trimmed)) {
            return { ok: false, reason: `forbidden token pattern: ${pattern.source}` }
        }
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
    } finally {
        tree.delete()
    }

    return { ok: true }
}
