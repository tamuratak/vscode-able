import { parseMermaidClassDiagram, MermaidClass, MermaidClassAttribute, MermaidClassMethod, MermaidDiagram, MermaidRelation, MermaidRelationType } from './mermaidparser.js'
import { collectClassDefinitions, ClassDefinition, ClassProperty } from './tsparser.js'

export interface SourceFile {
	path: string
	content: string
}

export interface AnalyzerInput {
	markdown: string
	sourceFiles?: SourceFile[] | undefined
}

export async function generateFocusedMermaidDiagram(input: AnalyzerInput): Promise<string | undefined> {
	const { description, diagrams } = splitMarkdownSections(input.markdown)
	if (diagrams.length === 0) {
		return undefined
	}
	const tokens = collectDescriptionTokens(description)
	if (tokens.size === 0) {
		return undefined
	}
	const mermaidDiagrams = diagrams.map(parseMermaidClassDiagram)
	const mermaidClasses = mergeMermaidClasses(mermaidDiagrams)
	const mermaidRelations = mergeMermaidRelations(mermaidDiagrams)
	const tsClasses = await gatherClasses(input.sourceFiles ?? [])
	const tsClassMap = new Map(tsClasses.map((entry) => [entry.name, entry]))
	const memberIndex = buildMemberIndex(mermaidClasses, tsClasses)
	const includedClasses = determineIncludedClasses(memberIndex, tokens)
	if (includedClasses.size === 0) {
		return undefined
	}
	const classBlocks = buildClassBlocks(includedClasses, tokens, mermaidClasses, tsClassMap)
	const relations = buildRelations(includedClasses, tokens, mermaidClasses, tsClassMap, mermaidRelations)
	const sortedRelations = relations.sort((a, b) => {
		const fromCompare = a.from.localeCompare(b.from)
		if (fromCompare !== 0) {
			return fromCompare
		}
		const toCompare = a.to.localeCompare(b.to)
		if (toCompare !== 0) {
			return toCompare
		}
		return a.type.localeCompare(b.type)
	})
	const relationLines = sortedRelations.map((relation) => relationToLine(relation))
	return ['classDiagram', ...classBlocks, ...relationLines].join('\n')
}

function splitMarkdownSections(markdown: string): { description: string; diagrams: string[] } {
	const lines = markdown.split(/\r?\n/)
	const descriptionLines: string[] = []
	const diagrams: string[] = []
	let inCodeBlock = false
	const currentBlock: string[] = []
	for (const line of lines) {
		const trimmed = line.trim()
		if (trimmed.startsWith('```')) {
			if (inCodeBlock) {
				const content = currentBlock.join('\n')
				if (isMermaidDiagram(content)) {
					diagrams.push(content)
				}
				currentBlock.length = 0
				inCodeBlock = false
			} else {
				inCodeBlock = true
			}
			continue
		}
		if (inCodeBlock) {
			currentBlock.push(line)
			continue
		}
		descriptionLines.push(line)
	}
	return { description: descriptionLines.join('\n').trim(), diagrams }
}

function isMermaidDiagram(content: string): boolean {
	for (const rawLine of content.split(/\r?\n/)) {
		const trimmed = rawLine.trim()
		if (trimmed.length === 0 || trimmed.startsWith('%%')) {
			continue
		}
		return trimmed.startsWith('classDiagram')
	}
	return false
}

function collectDescriptionTokens(description: string): Set<string> {
	const result = new Set<string>()
	const matches = description.match(/[A-Za-z0-9_]+/g)
	if (!matches) {
		return result
	}
	for (const token of matches) {
		result.add(token)
		result.add(token.toLowerCase())
		const capitalized = token[0]?.toUpperCase() + token.slice(1)
		if (capitalized !== token) {
			result.add(capitalized)
		}
	}
	return result
}

function buildMemberIndex(mermaidClasses: Map<string, MermaidClass>, tsClasses: ClassDefinition[]) {
	const index = new Map<string, { attributes: Set<string>; methods: Set<string> }>()
	for (const [name, entry] of mermaidClasses) {
		const attributes = new Set<string>()
		for (const attribute of entry.attributes) {
			if (attribute.name.length > 0) {
				attributes.add(attribute.name)
			}
		}
		const methods = new Set<string>()
		for (const method of entry.methods) {
			if (method.name.length > 0) {
				methods.add(method.name)
			}
		}
		index.set(name, { attributes, methods })
	}
	for (const tsClass of tsClasses) {
		const entry = index.get(tsClass.name) ?? { attributes: new Set(), methods: new Set() }
		for (const attribute of tsClass.properties) {
			if (attribute.name.length > 0) {
				entry.attributes.add(attribute.name)
			}
		}
		for (const method of tsClass.methods) {
			if (method.name.length > 0) {
				entry.methods.add(method.name)
			}
		}
		index.set(tsClass.name, entry)
	}
	return index
}

function determineIncludedClasses(memberIndex: Map<string, { attributes: Set<string>; methods: Set<string> }>, tokens: Set<string>) {
	const result = new Set<string>()
	for (const [className, members] of memberIndex) {
		if (matchesToken(className, tokens)) {
			result.add(className)
			continue
		}
		let shouldAdd = false
		for (const attribute of members.attributes) {
			if (matchesToken(attribute, tokens)) {
				shouldAdd = true
				break
			}
		}
		if (shouldAdd) {
			result.add(className)
			continue
		}
		for (const method of members.methods) {
			if (matchesToken(method, tokens)) {
				result.add(className)
				break
			}
		}
	}
	return result
}

function matchesToken(value: string, tokens: Set<string>): boolean {
	if (value.length === 0) {
		return false
	}
	if (tokens.has(value)) {
		return true
	}
	if (tokens.has(value.toLowerCase())) {
		return true
	}
	return false
}

async function gatherClasses(sourceFiles: SourceFile[]): Promise<ClassDefinition[]> {
	const entries: ClassDefinition[] = []
	for (const file of sourceFiles) {
		const definitions = await collectClassDefinitions(file.content)
		if (definitions) {
			entries.push(...definitions)
		}
	}
	return entries
}

function mergeMermaidClasses(diagrams: MermaidDiagram[]): Map<string, MermaidClass> {
	const result = new Map<string, MermaidClass>()
	for (const diagram of diagrams) {
		for (const entry of diagram.classes) {
			const existing = result.get(entry.name)
			if (!existing) {
				result.set(entry.name, {
					name: entry.name,
					attributes: [...entry.attributes],
					methods: [...entry.methods]
				})
				continue
			}
			mergeAttributes(existing.attributes, entry.attributes)
			mergeMethods(existing.methods, entry.methods)
		}
	}
	return result
}

function mergeMermaidRelations(diagrams: MermaidDiagram[]): MermaidRelation[] {
	const result: MermaidRelation[] = []
	for (const diagram of diagrams) {
		result.push(...diagram.relations)
	}
	return result
}

function mergeAttributes(target: MermaidClassAttribute[], source: MermaidClassAttribute[]) {
	const seen = new Set(target.map((attribute) => `${attribute.name}|${attribute.text}`))
	for (const attribute of source) {
		const key = `${attribute.name}|${attribute.text}`
		if (seen.has(key)) {
			continue
		}
		seen.add(key)
		target.push(attribute)
	}
}

function mergeMethods(target: MermaidClassMethod[], source: MermaidClassMethod[]) {
	const seen = new Set(target.map((method) => `${method.name}|${method.text}`))
	for (const method of source) {
		const key = `${method.name}|${method.text}`
		if (seen.has(key)) {
			continue
		}
		seen.add(key)
		target.push(method)
	}
}

function buildClassBlocks(
	includedClasses: Set<string>,
	tokens: Set<string>,
	mermaidClasses: Map<string, MermaidClass>,
	tsClassMap: Map<string, ClassDefinition>
): string[] {
	const sorted = Array.from(includedClasses).sort((a, b) => a.localeCompare(b))
	const blocks: string[] = []
	for (const className of sorted) {
		const members = buildMembersForClass(className, tokens, mermaidClasses, tsClassMap)
		if (members.properties.length === 0 && members.methods.length === 0) {
			blocks.push(`	class ${className}`)
			continue
		}
		blocks.push(`	class ${className} {`)
		for (const property of members.properties) {
			blocks.push(`		${property}`)
		}
		for (const method of members.methods) {
			blocks.push(`		${method}`)
		}
		blocks.push('	}')
	}
	return blocks
}

function buildMembersForClass(
	className: string,
	tokens: Set<string>,
	mermaidClasses: Map<string, MermaidClass>,
	tsClassMap: Map<string, ClassDefinition>
): { properties: string[]; methods: string[] } {
	const propertyEntries = new Map<string, string>()
	const methodEntries = new Map<string, string>()
	const tsClass = tsClassMap.get(className)
	if (tsClass) {
		for (const property of tsClass.properties) {
			if (property.name.length === 0) {
				continue
			}
			if (!matchesToken(property.name, tokens)) {
				continue
			}
			const representation = property.type ? `${property.name}: ${property.type}` : property.name
			propertyEntries.set(property.name, representation)
		}
		for (const method of tsClass.methods) {
			if (method.name.length === 0) {
				continue
			}
			if (!matchesToken(method.name, tokens)) {
				continue
			}
			methodEntries.set(method.name, `${method.name}()`)
		}
	}
	const mermaidClass = mermaidClasses.get(className)
	if (mermaidClass) {
		for (const attribute of mermaidClass.attributes) {
			if (!matchesToken(attribute.name, tokens)) {
				continue
			}
			if (!propertyEntries.has(attribute.name)) {
				propertyEntries.set(attribute.name, attribute.text)
			}
		}
		for (const method of mermaidClass.methods) {
			if (!matchesToken(method.name, tokens)) {
				continue
			}
			if (!methodEntries.has(method.name)) {
				methodEntries.set(method.name, method.text)
			}
		}
	}
	return {
		properties: Array.from(propertyEntries.values()),
		methods: Array.from(methodEntries.values())
	}
}

function buildRelations(
	includedClasses: Set<string>,
	tokens: Set<string>,
	mermaidClasses: Map<string, MermaidClass>,
	tsClassMap: Map<string, ClassDefinition>,
	mermaidRelations: MermaidRelation[]
): MermaidRelation[] {
	const results: MermaidRelation[] = []
	const seen = new Set<string>()
	const addRelation = (relation: MermaidRelation) => {
		const key = `${relation.from}|${relation.type}|${relation.to}|${relation.label ?? ''}`
		if (seen.has(key)) {
			return
		}
		seen.add(key)
		results.push(relation)
	}
	for (const className of includedClasses) {
		const tsClass = tsClassMap.get(className)
		if (tsClass?.extends && includedClasses.has(tsClass.extends)) {
			addRelation({ from: tsClass.extends, to: className, type: 'extends' })
		}
		if (tsClass) {
			for (const property of tsClass.properties) {
				if (property.name.length === 0 || !matchesToken(property.name, tokens)) {
					continue
				}
				for (const target of findReferencedClasses(property.type, includedClasses)) {
					addRelation({ from: className, to: target, type: 'has', label: property.name })
				}
			}
			for (const method of tsClass.methods) {
				if (method.name.length === 0 || !matchesToken(method.name, tokens)) {
					continue
				}
				for (const call of method.calls) {
					const label = call.targetMethod
						? `${method.name} -> ${call.targetMethod}`
						: method.name
					if (includedClasses.has(call.targetClass)) {
						addRelation({ from: className, to: call.targetClass, type: 'calls', label })
						continue
					}
					const property = findPropertyForCallTarget(tsClass.properties, call.targetClass)
					if (!property?.type) {
						continue
					}
					for (const target of findReferencedClasses(property.type, includedClasses)) {
						addRelation({ from: className, to: target, type: 'calls', label })
					}
				}
			}
		}
		const mermaidClass = mermaidClasses.get(className)
		if (mermaidClass) {
			for (const attribute of mermaidClass.attributes) {
				if (!matchesToken(attribute.name, tokens)) {
					continue
				}
				for (const target of findReferencedClasses(attribute.type, includedClasses)) {
					addRelation({ from: className, to: target, type: 'has', label: attribute.name })
				}
			}
		}
	}
	for (const relation of mermaidRelations) {
		if (!includedClasses.has(relation.from) || !includedClasses.has(relation.to)) {
			continue
		}
		addRelation(relation)
	}
	return results
}

function findReferencedClasses(type: string | undefined, includedClasses: Set<string>): string[] {
	if (!type) {
		return []
	}
	const result: string[] = []
	for (const className of includedClasses) {
		const pattern = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(className)}([^A-Za-z0-9_]|$)`)
		if (pattern.test(type)) {
			result.push(className)
		}
	}
	return result
}

function findPropertyForCallTarget(properties: ClassProperty[], callTarget: string): ClassProperty | undefined {
	for (const property of properties) {
		if (matchesCallTarget(callTarget, property.name)) {
			return property
		}
	}
	return undefined
}

function matchesCallTarget(callTarget: string, propertyName: string): boolean {
	if (propertyName.length === 0) {
		return false
	}
	if (callTarget === propertyName) {
		return true
	}
	if (callTarget.endsWith(`.${propertyName}`)) {
		return true
	}
	return false
}

function relationToLine(relation: MermaidRelation): string {
	const arrow = arrowForType(relation.type)
	const label = relation.label ? ` : ${relation.label}` : ''
	return `	${relation.from} ${arrow} ${relation.to}${label}`
}

function arrowForType(type: MermaidRelationType): string {
	switch (type) {
		case 'extends':
			return '<|--'
		case 'has':
			return 'o--'
		case 'calls':
			return '..>'
		case 'association':
			return '-->'
        default:
            return '-->'
	}
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
