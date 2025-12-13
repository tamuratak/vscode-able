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
    const tree = parser.parse('echo "Hello, world!"\ncd /home/user\nsed -i "s/foo/bar/" file.txt')

    const query = new treesitter.Query(language, `
    (command
        name: (command_name (word)) @cmd_name
        argument: (_) @arg
    )`)

    if (!tree) {
        console.error('Failed to parse input')
        return
    }
    const captures = query.captures(tree.rootNode)
    console.log('Captures:', captures)
}

void doParse()
