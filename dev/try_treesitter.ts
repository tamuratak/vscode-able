import { importAMDNodeModule, resolveAmdNodeModulePath } from '../src/utils/amdx'

const treeSitterModuleName = '@vscode/tree-sitter-wasm'
const treeSitterScriptPath = 'wasm/tree-sitter.js'
const bashLanguagePath = 'wasm/tree-sitter-bash.wasm'

let cachedTreeSitterModule: Promise<any> | undefined

async function loadTreeSitterBindings() {
    if (!cachedTreeSitterModule) {
        cachedTreeSitterModule = importAMDNodeModule(treeSitterModuleName, treeSitterScriptPath, true)
    }
    const treesitterRaw = await cachedTreeSitterModule
    let treesitter = treesitterRaw
    if (!treesitter || !treesitter.Parser) {
        const factory = typeof treesitterRaw === 'function' ? treesitterRaw : treesitterRaw?.default
        if (typeof factory === 'function') {
            treesitter = await factory()
        }
    }
    if (!treesitter || !treesitter.Parser) {
        throw new Error('Tree-sitter bindings did not expose Parser')
    }
    return treesitter
}

async function doParse() {
    const treesitter = await loadTreeSitterBindings()
    await treesitter.Parser.init()
    console.log(treesitter.Parser)
    const parser = new treesitter.Parser()
    const languagePath = resolveAmdNodeModulePath(treeSitterModuleName, bashLanguagePath)
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