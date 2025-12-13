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
    const source = 'cd /Users/tamura/src/github/vscode-copilot-chat && nl -ba src/extension/prompts/node/inline/inlineChatFix3Prompt.tsx | sed -n \'60,120p\''
    const tree = parser.parse(source)

    const query = new treesitter.Query(language, `
    (command
        name: (command_name (word)) @cmd_name
        argument: (_) @arg
    )
    (command
        name: (command_name (word)) @cmd_name
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
    console.log('\n--- Query Matches ---')
    for (let i = 0; i < matches.length; i++) {
        const m = matches[i]
        // collect command name and arguments within the same match
        let cmdNode = undefined
        const args = []
        for (let j = 0; j < m.captures.length; j++) {
            const cap = m.captures[j]
            if (cap.name === 'cmd_name') cmdNode = cap.node
            if (cap.name === 'arg') args.push(cap.node)
        }
        const cmdText = cmdNode ? getNodeText(cmdNode).replace(/\n/g, '\\n') : '<unknown>'
        const argTexts = []
        for (const a of args) argTexts.push(getNodeText(a).replace(/\n/g, '\\n'))
        console.log(`#${i} command: "${cmdText}" args: ${JSON.stringify(argTexts)}`)

        // optional: print each capture with positions
        for (let j = 0; j < m.captures.length; j++) {
            const cap = m.captures[j]
            const n = cap.node
            const txt = getNodeText(n).replace(/\n/g, '\\n')
            const start = n.startPosition
            const end = n.endPosition
            console.log(`  @${cap.name}: ${n.type} [${start.row}:${start.column}-${end.row}:${end.column}] -> "${txt}"`)
        }
    }
}

void doParse()
