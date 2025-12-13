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
    const source = 'echo "Hello, world!"\ncd /home/user\nsed -i "s/foo/bar/" file.txt'
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

    function printNode(node, indent = '') {
        const start = node.startPosition
        const end = node.endPosition
        const text = getNodeText(node).replace(/\n/g, '\\n')
        console.log(`${indent}${node.type} [${start.row}:${start.column}-${end.row}:${end.column}] -> "${text}"`)
        const children = node.children && node.children.length ? node.children : (node.namedChildren || [])
        for (let i = 0; i < children.length; i++) {
            const child = children[i]
            printNode(child, indent + '  ')
        }
    }

    console.log('--- Parse Tree ---')
    printNode(tree.rootNode)

    const captures = query.captures(tree.rootNode)
    console.log('\n--- Query Captures ---')
    for (let i = 0; i < captures.length; i++) {
        const c = captures[i]
        const n = c.node
        const txt = getNodeText(n).replace(/\n/g, '\\n')
        const start = n.startPosition
        const end = n.endPosition
        console.log(`#${i} @${c.name}: ${n.type} [${start.row}:${start.column}-${end.row}:${end.column}] -> "${txt}"`)
    }
}

void doParse()
