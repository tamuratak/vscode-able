import { createRequire } from 'node:module'
import treeSitter from '#vscode-tree-sitter-wasm'

const nodeRequire = createRequire(__filename)
const treeSitterWasmPath = nodeRequire.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter.wasm')
const typeScriptLanguagePath = nodeRequire.resolve('@vscode/tree-sitter-wasm/wasm/tree-sitter-typescript.wasm')

let parser: treeSitter.Parser | undefined
let tsLanguage: treeSitter.Language | undefined
const parserInitialization = ensureParserInitialized()

async function ensureParserInitialized(): Promise<void> {
	await treeSitter.Parser.init({ locateFile: () => treeSitterWasmPath })
	tsLanguage = await treeSitter.Language.load(typeScriptLanguagePath)
	parser = new treeSitter.Parser()
	parser.setLanguage(tsLanguage)
}

export interface NamedImport {
	name: string
	alias?: string | undefined
}

export interface ImportStatement {
	module: string
	defaultBinding?: string | undefined
	namespaceImport?: string | undefined
	namedImports: NamedImport[]
}

export type ExportedSymbolKind = 'const' | 'let' | 'var' | 'function' | 'class' | 'interface' | 'type' | 'enum'

export interface ExportedSymbol {
	name: string
	kind: ExportedSymbolKind
}

export async function collectImports(source: string): Promise<ImportStatement[] | undefined> {
	await parserInitialization
	if (!parser) {
		return undefined
	}

	const tree = parser.parse(source)
	if (!tree) {
		return undefined
	}

	try {
		const imports: ImportStatement[] = []
		for (const node of tree.rootNode.namedChildren) {
			if (!node || node.type !== 'import_statement') {
				continue
			}
			const moduleNode = findNamedChild(node, 'string')
			if (!moduleNode) {
				continue
			}
			const moduleName = normalizeStringLiteral(getNodeText(moduleNode, source))
			const clause = findNamedChild(node, 'import_clause')
			const defaultBinding = clause ? extractDefaultBinding(clause, source) : undefined
			const namespaceImport = clause ? extractNamespaceImport(clause, source) : undefined
			const namedImports = clause ? collectNamedImports(clause, source) : []
			imports.push({
				module: moduleName,
				defaultBinding,
				namespaceImport,
				namedImports
			})
		}
		return imports
	} finally {
		tree.delete()
	}
}

export async function collectExportedSymbols(source: string): Promise<ExportedSymbol[] | undefined> {
	await parserInitialization
	if (!parser) {
		return undefined
	}

	const tree = parser.parse(source)
	if (!tree) {
		return undefined
	}

	try {
		const symbols: ExportedSymbol[] = []
		for (const node of tree.rootNode.namedChildren) {
			if (!node || node.type !== 'export_statement') {
				continue
			}
			for (let i = 0; i < node.namedChildCount; i++) {
				const declaration = node.namedChild(i)
				if (!declaration) {
					continue
				}
				const extracted = extractExportedSymbols(declaration, source)
				for (const symbol of extracted) {
					symbols.push(symbol)
				}
			}
		}
		return symbols
	} finally {
		tree.delete()
	}
}

function extractDefaultBinding(clause: treeSitter.Node, source: string): string | undefined {
	for (let i = 0; i < clause.namedChildCount; i++) {
		const child = clause.namedChild(i)
		if (child && child.type === 'identifier') {
			return getNodeText(child, source)
		}
	}
	return undefined
}

function extractNamespaceImport(clause: treeSitter.Node, source: string): string | undefined {
	for (let i = 0; i < clause.namedChildCount; i++) {
		const child = clause.namedChild(i)
		if (child && child.type === 'namespace_import') {
			for (let j = 0; j < child.namedChildCount; j++) {
				const nested = child.namedChild(j)
				if (nested && nested.type === 'identifier') {
					return getNodeText(nested, source)
				}
			}
		}
	}
	return undefined
}

function collectNamedImports(clause: treeSitter.Node, source: string): NamedImport[] {
	const namedImportsNode = findNamedChild(clause, 'named_imports')
	if (!namedImportsNode) {
		return []
	}
	const imports: NamedImport[] = []
	for (let i = 0; i < namedImportsNode.namedChildCount; i++) {
		const specifier = namedImportsNode.namedChild(i)
		if (!specifier || specifier.type !== 'import_specifier') {
			continue
		}
		const identifiers: treeSitter.Node[] = []
		for (let j = 0; j < specifier.namedChildCount; j++) {
			const candidate = specifier.namedChild(j)
			if (candidate && candidate.type === 'identifier') {
				identifiers.push(candidate)
			}
		}
		if (identifiers.length === 0) {
			continue
		}
		const name = getNodeText(identifiers[0], source)
		const alias = identifiers.length > 1 ? getNodeText(identifiers[1], source) : undefined
		imports.push({ name, alias })
	}
	return imports
}

function extractExportedSymbols(node: treeSitter.Node, source: string): ExportedSymbol[] {
	switch (node.type) {
		case 'function_declaration':
		case 'class_declaration':
		case 'interface_declaration':
		case 'type_alias_declaration':
		case 'enum_declaration':
			return createSymbolFromDeclaration(node, source)
		case 'lexical_declaration':
			return createSymbolsFromLexical(node, source)
		default:
			return []
	}
}

function createSymbolFromDeclaration(node: treeSitter.Node, source: string): ExportedSymbol[] {
	const kind = mapDeclarationKind(node.type)
	if (!kind) {
		return []
	}
	const nameNode = node.childForFieldName('name')
	if (!nameNode) {
		return []
	}
	return [{
		name: getNodeText(nameNode, source),
		kind
	}]
}

function createSymbolsFromLexical(node: treeSitter.Node, source: string): ExportedSymbol[] {
	const kindToken = node.child(0)
	const kind = kindToken ? parseVariableKind(kindToken.type) : undefined
	if (!kind) {
		return []
	}
	const result: ExportedSymbol[] = []
	for (let i = 0; i < node.namedChildCount; i++) {
		const child = node.namedChild(i)
		if (!child || child.type !== 'variable_declarator') {
			continue
		}
		const nameNode = child.childForFieldName('name')
		if (nameNode) {
			result.push({ name: getNodeText(nameNode, source), kind })
		}
	}
	return result
}

function mapDeclarationKind(nodeType: string): ExportedSymbolKind | undefined {
	switch (nodeType) {
		case 'function_declaration':
			return 'function'
		case 'class_declaration':
			return 'class'
		case 'interface_declaration':
			return 'interface'
		case 'type_alias_declaration':
			return 'type'
		case 'enum_declaration':
			return 'enum'
		default:
			return undefined
	}
}

function parseVariableKind(typeName: string): ExportedSymbolKind | undefined {
	if (typeName === 'const' || typeName === 'let' || typeName === 'var') {
		return typeName
	}
	return undefined
}

function normalizeStringLiteral(value: string): string {
	const trimmed = value.trim()
	if (trimmed.length >= 2) {
		const first = trimmed[0]
		const last = trimmed[trimmed.length - 1]
		if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === '`' && last === '`')) {
			return trimmed.slice(1, -1)
		}
	}
	return trimmed
}

function getNodeText(node: treeSitter.Node, source: string): string {
	return source.slice(node.startIndex, node.endIndex)
}

function findNamedChild(node: treeSitter.Node, type: string): treeSitter.Node | undefined {
	for (let i = 0; i < node.namedChildCount; i++) {
		const child = node.namedChild(i)
		if (child && child.type === type) {
			return child
		}
	}
	return undefined
}
