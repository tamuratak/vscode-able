---
name: how-to-verify-tree-sitter
description: How to verify tree-sitter operations in this project
---

## Purpose

Use `dev/debugtreesitter.mjs` to verify tree-sitter parsing behavior when you need to test grammar rules, node types, or query patterns.

## Core Constraints

- Never use `node -e '...'` to run tree-sitter code
- `#vscode-tree-sitter-wasm` is a project-specific import that only resolves through the project's own `package.json` `imports` field
- Running tree-sitter code outside of `dev/debugtreesitter.mjs` will fail because the module resolution chain is not available

## Recommended Workflow

1. Edit `dev/debugtreesitter.mjs` to contain the tree-sitter code you want to test
2. Run the script with `node dev/debugtreesitter.mjs`
3. Review the output and iterate on the code in `dev/debugtreesitter.mjs`
4. After verification, you may restore the original content or leave your test code in place

## Example

The following code is already present in `dev/debugtreesitter.mjs` and demonstrates how to load the tree-sitter module and parse bash code:

```js
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

const src = 'echo hi > output.txt'
const tree = parser.parse(src)
const root = tree.rootNode
console.log(root.toString())
tree.delete()
```

To test a different grammar or input, modify the language loading and the `src` variable in `dev/debugtreesitter.mjs`, then run:

```
node dev/debugtreesitter.mjs
```
