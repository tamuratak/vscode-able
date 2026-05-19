import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const nodeRequire = createRequire(__filename)

const treeSitterPath = nodeRequire.resolve('#vscode-tree-sitter-wasm')
const treeSitter = await import(treeSitterPath)
const treeSitterDefault = treeSitter.default

const wasmPath = nodeRequire.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm')
await treeSitterDefault.Parser.init({ locateFile: () => wasmPath })
const bashPath = nodeRequire.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter-bash.wasm')
const bashLang = await treeSitterDefault.Language.load(bashPath)
const parser = new treeSitterDefault.Parser()
parser.setLanguage(bashLang)

const tests = [
    'echo hi > output.txt',
    'echo hello >> logs.txt',
    'echo hi 2> errors.txt',
    'echo hello > /dev/null',
    'echo hi >&hoge foo 1',
    'rg pattern > /dev/null 2>&1',
]

for (const src of tests) {
    const tree = parser.parse(src)
    const root = tree.rootNode

    function walk(node, indent) {
        if (node.type === 'file_redirect' || (node.parent && node.parent.type === 'file_redirect')) {
            const named = []
            for (let i = 0; i < node.namedChildCount; i++) {
                const c = node.namedChild(i)
                named.push({ type: c.type, text: src.slice(c.startIndex, c.endIndex) })
            }
            const all = []
            for (let i = 0; i < node.childCount; i++) {
                const c = node.child(i)
                all.push({ type: c.type, text: src.slice(c.startIndex, c.endIndex), named: c.isNamed })
            }
            console.log(indent + node.type + ': ' + JSON.stringify({ text: src.slice(node.startIndex, node.endIndex), namedChildren: named, allChildren: all }))
        }
        for (let i = 0; i < node.namedChildCount; i++) {
            walk(node.namedChild(i), indent + '  ')
        }
    }
    console.log('=== ' + src + ' ===')
    walk(root, '')
    tree.delete()
    console.log('')
}
