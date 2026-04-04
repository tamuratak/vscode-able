import treeSitter from '#vscode-tree-sitter-wasm'
import { createRequire } from 'node:module'


const nodeRequire = createRequire(__filename)
const treeSitterWasmPath = nodeRequire.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm')
export const treeSitterParserInit = treeSitter.Parser.init({ locateFile: () => treeSitterWasmPath })
