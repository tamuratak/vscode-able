---
name: how-to-verify-tree-sitter
description: How to verify tree-sitter operations in this project
---

## Purpose

Use `node -e '...'` to verify tree-sitter parsing behavior when you need to test grammar rules, node types, or query patterns.

## Core Constraints

- Use `node -e '...'` for verification. `dev/debugtreesitter.mjs` is only a reference, for example to see how a query or grammar is loaded in this project.
- `#vscode-tree-sitter-wasm` is a project-specific import that only resolves through the project's own `package.json` `imports` field. It cannot be used inside `node -e`.
- Load `@vscode/tree-sitter-wasm` directly with `require()` instead. Run the command from the vscode-able directory so that `node_modules` resolves.

## Recommended Workflow

1. Write a one-liner that loads the tree-sitter WASM and the grammar with `require()`.
2. Run it from the project root: `node -e '...'`.
3. Review the printed parse tree or query matches and iterate on the source string and query.

## Example

The following one-liner loads the tree-sitter module and parses bash code:

```sh
cd /Users/tamura/src/github/vscode-able && node -e '
const treeSitter = require("@vscode/tree-sitter-wasm")
;(async () => {
    const t = treeSitter.default ?? treeSitter
    await t.Parser.init({ locateFile: () => require.resolve("@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm") })
    const lang = await t.Language.load(require.resolve("@vscode/tree-sitter-wasm/wasm/tree-sitter-bash.wasm"))
    const parser = new t.Parser()
    parser.setLanguage(lang)
    const tree = parser.parse("echo hi > output.txt")
    console.log(tree.rootNode.toString())
    tree.delete()
})()
'
```

To test a different grammar or input, modify the language loading and the source string in the one-liner, then run it again with `node -e '...'`.
