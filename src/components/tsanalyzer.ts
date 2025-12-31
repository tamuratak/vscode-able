import { promises as fs } from 'node:fs'
import { ClassDefinition, ClassMethod, ClassProperty, collectClassDefinitions } from './tsparser.js'

const methodKeywords = ['method', 'methods', 'function', 'call', 'calls', 'invoke', 'invokes', 'メソッド', '関数', '呼び出']
const propertyKeywords = ['property', 'properties', 'field', 'fields', 'member', 'members', 'プロパティ', 'フィールド', 'インスタンス変数', '持つ', 'has']
const contextWindow = 40

export interface DescriptionMentions {
	classes: Set<string>
	properties: Map<string, Set<string>>
	methods: Map<string, Set<string>>
}

export interface MermaidGenerationOptions {
	sourcePath: string
	descriptionPath: string
	outputPath: string
}

export async function analyzeAndWriteMermaid(options: MermaidGenerationOptions): Promise<string> {
	const [source, description] = await Promise.all([
		fs.readFile(options.sourcePath, 'utf8'),
		fs.readFile(options.descriptionPath, 'utf8')
	])
	const diagram = await buildMermaidDiagramFromContent(source, description)
	await fs.writeFile(options.outputPath, diagram, 'utf8')
	return diagram
}

export async function buildMermaidDiagramFromContent(source: string, description: string): Promise<string> {
	const mentions = parseDescriptionMentions(description)
	const definitions = await collectClassDefinitions(source)
	if (!definitions) {
		throw new Error('Unable to parse source file for class definitions')
	}
	const model = buildDiagramModel(definitions, mentions)
	return renderMermaidDiagram(model)
}

export function parseDescriptionMentions(description: string): DescriptionMentions {
	const mentions: DescriptionMentions = {
		classes: new Set(),
		properties: new Map(),
		methods: new Map()
	}
	const expression = /`([^`]+)`/g
	let match: RegExpExecArray | null
	while ((match = expression.exec(description)) !== null) {
		const token = match[1].trim()
		if (!token) {
			continue
		}
		const before = description.slice(Math.max(0, match.index - contextWindow), match.index).toLowerCase()
		const afterIndex = match.index + match[0].length
		const after = description.slice(afterIndex, afterIndex + contextWindow).toLowerCase()
		const member = splitMemberToken(token)
		if (!member) {
			mentions.classes.add(token)
			continue
		}
		mentions.classes.add(member.className)
		const kind = classifyMemberMention(member.separator, before + after)
		if (kind === 'method') {
			addMention(mentions.methods, member.className, member.memberName)
		} else {
			addMention(mentions.properties, member.className, member.memberName)
		}
	}
	return mentions
}

interface DiagramClass {
	name: string
	properties: ClassProperty[]
	methods: ClassMethod[]
}

interface DiagramModel {
	classes: DiagramClass[]
	extendsEdges: { derived: string; base: string }[]
	hasEdges: { source: string; target: string; label: string }[]
	callEdges: { source: string; target: string; label: string }[]
}

function buildDiagramModel(definitions: ClassDefinition[], mentions: DescriptionMentions): DiagramModel {
	const classMap = new Map(definitions.map((definition) => [definition.name, definition]))
	const classes: DiagramClass[] = []
	const extendsEdges: { derived: string; base: string }[] = []
	const hasEdges: { source: string; target: string; label: string }[] = []
	const callEdges: { source: string; target: string; label: string }[] = []
	const requestedClasses = Array.from(mentions.classes).sort((a, b) => a.localeCompare(b))
	for (const className of requestedClasses) {
		const definition = classMap.get(className)
		if (!definition) {
			continue
		}
		const propertyNames = mentions.properties.get(className) ?? new Set<string>()
		const methodNames = mentions.methods.get(className) ?? new Set<string>()
		const properties: ClassProperty[] = []
		for (const propertyName of Array.from(propertyNames).sort()) {
			const found = definition.properties.find((property) => property.name === propertyName)
			properties.push(found ?? { name: propertyName })
		}
		const methods: ClassMethod[] = []
		for (const methodName of Array.from(methodNames).sort()) {
			const found = definition.methods.find((method) => method.name === methodName)
			methods.push(found ?? { name: methodName, calls: [] })
		}
		classes.push({ name: className, properties, methods })
		if (definition.extends && mentions.classes.has(definition.extends)) {
			extendsEdges.push({ derived: className, base: definition.extends })
		}
		for (const property of properties) {
			if (!property.type) {
				continue
			}
			for (const candidate of mentions.classes) {
				if (matchClassInType(property.type, candidate)) {
					hasEdges.push({ source: className, target: candidate, label: property.name })
				}
			}
		}
		const methodMention = mentions.methods.get(className)
		for (const method of methods) {
			if (!methodMention || !methodMention.has(method.name)) {
				continue
			}
			for (const call of method.calls) {
				if (!mentions.classes.has(call.targetClass)) {
					continue
				}
				const targetMethods = mentions.methods.get(call.targetClass)
				if (!targetMethods || !targetMethods.has(call.targetMethod)) {
					continue
				}
				callEdges.push({ source: className, target: call.targetClass, label: call.targetMethod })
			}
		}
	}
	return { classes, extendsEdges, hasEdges, callEdges }
}

function renderMermaidDiagram(model: DiagramModel): string {
	const lines: string[] = ['classDiagram']
	const sortedClasses = [...model.classes].sort((a, b) => a.name.localeCompare(b.name))
	for (const diagramClass of sortedClasses) {
		const hasMembers = diagramClass.properties.length > 0 || diagramClass.methods.length > 0
		if (hasMembers) {
			lines.push(`    class ${diagramClass.name} {`)
			for (const property of diagramClass.properties) {
				const suffix = property.type ? `: ${property.type}` : ''
				lines.push(`        +${property.name}${suffix}`)
			}
			for (const method of diagramClass.methods) {
				lines.push(`        +${method.name}()`)
			}
			lines.push('    }')
		} else {
			lines.push(`    class ${diagramClass.name}`)
		}
	}
	const extendsLines = Array.from(new Set(model.extendsEdges.map((edge) => `    ${edge.base} <|-- ${edge.derived}`))).sort()
	const hasLines = Array.from(new Set(model.hasEdges.map((edge) => `    ${edge.source} --> ${edge.target} : ${edge.label}`))).sort()
	const callLines = Array.from(new Set(model.callEdges.map((edge) => `    ${edge.source} ..> ${edge.target} : calls ${edge.label}()`))).sort()
	lines.push(...extendsLines, ...hasLines, ...callLines)
	return lines.join('\n') + '\n'
}

function matchClassInType(typeText: string, className: string): boolean {
	if (!typeText) {
		return false
	}
	const pattern = new RegExp(`\\b${escapeRegExp(className)}\\b`)
	return pattern.test(typeText)
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')
}

function splitMemberToken(token: string): { className: string; memberName: string; separator: string } | undefined {
	const separators = ['#', '::', '.']
	for (const separator of separators) {
		const index = token.indexOf(separator)
		if (index <= 0) {
			continue
		}
		const className = token.slice(0, index).trim()
		const memberName = stripParens(token.slice(index + separator.length))
		if (!className || !memberName) {
			continue
		}
		return { className, memberName, separator }
	}
	return undefined
}

function stripParens(value: string): string {
	return value.replace(/\(\s*\)$/, '').trim()
}

function classifyMemberMention(separator: string, context: string): 'method' | 'property' {
	if (separator === '#' || separator === '::') {
		return 'method'
	}
	if (containsKeyword(context, methodKeywords)) {
		return 'method'
	}
	if (containsKeyword(context, propertyKeywords)) {
		return 'property'
	}
	return 'property'
}

function containsKeyword(context: string, keywords: readonly string[]): boolean {
	for (const keyword of keywords) {
		if (context.includes(keyword)) {
			return true
		}
	}
	return false
}

function addMention(map: Map<string, Set<string>>, className: string, memberName: string): void {
	let entries = map.get(className)
	if (!entries) {
		entries = new Set()
		map.set(className, entries)
	}
	entries.add(memberName)
}
