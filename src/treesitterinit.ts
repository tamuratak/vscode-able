import { ExternalPromise } from './utils/externalpromise.js'
import treeSitter from '#vscode-tree-sitter-wasm'
import { createRequire } from 'node:module'


const nodeRequire = createRequire(__filename)
const treeSitterWasmPath = nodeRequire.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm')
export const treeSitterParserInit =new ExternalPromise<void>()

async function initializeTreeSitterParser() {
    try {
        await treeSitter.Parser.init({ locateFile: () => treeSitterWasmPath })
        treeSitterParserInit.resolve()
    } catch (error) {
        console.error('Failed to initialize Tree Sitter parser:', error)
        treeSitterParserInit.reject(error)
    }
}

void initializeTreeSitterParser()
