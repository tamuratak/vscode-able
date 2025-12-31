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

export interface ClassProperty {
	name: string
	type?: string | undefined
}

export interface MethodCall {
	targetClass: string
	targetMethod: string
}

export interface ClassMethod {
	name: string
	calls: MethodCall[]
}

export interface ClassDefinition {
	name: string
	extends?: string | undefined
	implements: string[]
	properties: ClassProperty[]
	methods: ClassMethod[]
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

export async function collectClassDefinitions(source: string): Promise<ClassDefinition[] | undefined> {
	await parserInitialization
	if (!parser) {
		return undefined
	}

	const tree = parser.parse(source)
	if (!tree) {
		return undefined
	}

	try {
		const classes: ClassDefinition[] = []
		traverseNamedNodes(tree.rootNode, (node) => {
			if (node.type !== 'class_declaration') {
				return
			}
			const definition = createClassDefinition(node, source)
			if (definition) {
				classes.push(definition)
			}
		})
		return classes
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

const classPropertyNodeTypes = new Set([
	'public_field_definition',
	'private_field_definition',
	'protected_field_definition',
	'abstract_field_definition',
	'public_field_signature',
	'private_field_signature',
	'protected_field_signature',
	'property_signature',
	'readonly_property_signature',
	'decorated_field_definition'
])

function traverseNamedNodes(node: treeSitter.Node, callback: (node: treeSitter.Node) => void): void {
	callback(node)
	for (let i = 0; i < node.namedChildCount; i++) {
		const child = node.namedChild(i)
		if (child) {
			traverseNamedNodes(child, callback)
		}
	}
}

function createClassDefinition(node: treeSitter.Node, source: string): ClassDefinition | undefined {
	const nameNode = node.childForFieldName('name')
	if (!nameNode) {
		return undefined
	}
	const heritage = gatherClassHeritage(node, source)
	const body = findNamedChild(node, 'class_body')
	const members = body ? collectClassMembers(body, source) : { properties: [], methods: [] }
	return {
		name: getNodeText(nameNode, source),
		extends: heritage.extends,
		implements: heritage.implements,
		properties: members.properties,
		methods: members.methods
	}
}

function gatherClassHeritage(node: treeSitter.Node, source: string): { extends?: string; implements: string[] } {
	const result: { extends?: string; implements: string[] } = { implements: [] }
	const heritageNode = findNamedChild(node, 'class_heritage')
	if (!heritageNode) {
		return result
	}
	const extendsClause = findNamedChild(heritageNode, 'extends_clause')
	if (extendsClause) {
		const identifier = findHeritageIdentifier(extendsClause, source)
		if (identifier) {
			result.extends = identifier
		}
	}
	const implementsClause = findNamedChild(heritageNode, 'implements_clause')
	if (implementsClause) {
		for (let i = 0; i < implementsClause.namedChildCount; i++) {
			const child = implementsClause.namedChild(i)
			if (!child) {
				continue
			}
			const identifier = findHeritageIdentifier(child, source)
			if (identifier) {
				result.implements.push(identifier)
			}
		}
	}
	return result
}

function findHeritageIdentifier(node: treeSitter.Node | undefined, source: string): string | undefined {
	if (!node) {
		return undefined
	}
	const target = findNamedChild(node, 'identifier') ??
		findNamedChild(node, 'type_identifier') ??
		findNamedChild(node, 'scoped_identifier') ??
		findNamedChild(node, 'qualified_identifier')
	if (target) {
		return getNodeText(target, source)
	}
	return undefined
}

function collectClassMembers(body: treeSitter.Node, source: string): { properties: ClassProperty[]; methods: ClassMethod[] } {
	const properties: ClassProperty[] = []
	const methods: ClassMethod[] = []
	for (let i = 0; i < body.namedChildCount; i++) {
		const child = body.namedChild(i)
		if (!child) {
			continue
		}
		if (isClassPropertyNode(child)) {
			const property = createClassProperty(child, source)
			if (property) {
				properties.push(property)
			}
			continue
		}
		if (child.type === 'method_definition') {
			const method = createClassMethod(child, source)
			if (method) {
				methods.push(method)
			}
		}
	}
	return { properties, methods }
}

function isClassPropertyNode(node: treeSitter.Node): boolean {
	if (classPropertyNodeTypes.has(node.type)) {
		return true
	}
	const lowType = node.type.toLowerCase()
	return (lowType.includes('field') || lowType.includes('property')) && !lowType.includes('method')
}

function createClassProperty(node: treeSitter.Node, source: string): ClassProperty | undefined {
	const nameNode = findNamedChild(node, 'property_identifier') ??
		findNamedChild(node, 'identifier') ??
		findNamedChild(node, 'type_identifier')
	if (!nameNode) {
		return undefined
	}
	const property: ClassProperty = { name: getNodeText(nameNode, source) }
	const typeAnnotation = findNamedChild(node, 'type_annotation')
	if (typeAnnotation) {
		property.type = cleanTypeAnnotation(getNodeText(typeAnnotation, source))
	}
	return property
}

function createClassMethod(node: treeSitter.Node, source: string): ClassMethod | undefined {
	const nameNode = findNamedChild(node, 'property_identifier') ?? findNamedChild(node, 'identifier')
	if (!nameNode) {
		return undefined
	}
	const body = findMethodBody(node)
	return {
		name: getNodeText(nameNode, source),
		calls: body ? collectMethodCalls(body, source) : []
	}
}

function findMethodBody(node: treeSitter.Node): treeSitter.Node | undefined {
	return findNamedChild(node, 'statement_block') ?? findNamedChild(node, 'function_body')
}

function collectMethodCalls(root: treeSitter.Node, source: string): MethodCall[] {
	const calls: MethodCall[] = []
	traverseNamedNodes(root, (node) => {
		if (node.type !== 'call_expression') {
			return
		}
		const target = extractCallTarget(node, source)
		if (target) {
			calls.push(target)
		}
	})
	return calls
}

function extractCallTarget(node: treeSitter.Node, source: string): MethodCall | undefined {
	const functionNode = node.childForFieldName('function') ?? node.namedChild(0)
	if (!functionNode || functionNode.type !== 'member_expression') {
		return undefined
	}
	const objectNode = functionNode.namedChild(0)
	const propertyNode = functionNode.namedChild(1)
	if (!objectNode || !propertyNode) {
		return undefined
	}
	const objectText = getNodeText(objectNode, source)
	if (objectText === 'this' || objectText === 'super') {
		return undefined
	}
	if (propertyNode.type !== 'property_identifier') {
		return undefined
	}
	return {
		targetClass: objectText,
		targetMethod: getNodeText(propertyNode, source)
	}
}

function cleanTypeAnnotation(raw: string): string {
	const trimmed = raw.trim()
	if (trimmed.startsWith(':')) {
		return trimmed.slice(1).trim()
	}
	return trimmed
}
