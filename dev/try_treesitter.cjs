const treesitter = require('#vscode-tree-sitter-wasm')
const treesitterWasm = require.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm')
const languagePath = require.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter-bash.wasm')

async function doParse() {
    await treesitter.Parser.init({
        locateFile: () => treesitterWasm
    })
    console.log(treesitter.Parser)
    const parser = new treesitter.Parser()
    const language = await treesitter.Language.load(languagePath)
    parser.setLanguage(language)
    const source = 'cd /Users/tamura/src/github/vscode-copilot-chat < a && nl -ba src/extension/prompts/node/inline/inlineChatFix3Prompt.tsx | sed -n \'60,120p\''
    const tree = parser.parse(source)

    const query = new treesitter.Query(language, `
    (command
        name: (command_name (word)) @cmd_name
        argument: (_) @arg
    )`)

    if (!tree) {
        console.error('Failed to parse input')
        return
    }

    function getNodeText(node) {
        try {
            return source.slice(node.startIndex, node.endIndex)
        } catch (e) {
            return ''
        }
    }

    function printNode(node, indent = '', printHeader = true) {
        if (printHeader) {
            const start = node.startPosition
            const end = node.endPosition
            const text = getNodeText(node).replace(/\n/g, '\\n')
            console.log(`${indent}${node.type} [${start.row}:${start.column}-${end.row}:${end.column}] -> "${text}"`)
        }
        const count = node.childCount || 0
        for (let i = 0; i < count; i++) {
            const child = node.child(i)
            const field = node.fieldNameForChild(i) || ''
            const fieldPrefix = field ? `(${field}) ` : ''
            const childStart = child.startPosition
            const childEnd = child.endPosition
            const childText = getNodeText(child).replace(/\n/g, '\\n')
            console.log(`${indent}  ${fieldPrefix}${child.type} [${childStart.row}:${childStart.column}-${childEnd.row}:${childEnd.column}] -> "${childText}"`)
            printNode(child, indent + '    ', false)
        }
    }

    console.log('--- Parse Tree ---')
    printNode(tree.rootNode)

    const matches = query.matches(tree.rootNode)
    console.log('\n--- Query Matches ---', matches.length)
}

void doParse()
