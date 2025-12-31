export type MermaidRelationType = 'extends' | 'has' | 'calls' | 'association'

export interface MermaidClassAttribute {
	name: string
	text: string
	type?: string | undefined
}

export interface MermaidClassMethod {
	name: string
	text: string
}

export interface MermaidClass {
	name: string
	attributes: MermaidClassAttribute[]
	methods: MermaidClassMethod[]
}

export interface MermaidRelation {
	from: string
	to: string
	type: MermaidRelationType
	label?: string | undefined
}

export interface MermaidDiagram {
	classes: MermaidClass[]
	relations: MermaidRelation[]
}

export function parseMermaidClassDiagram(source: string): MermaidDiagram {
	const lines = source.split(/\r?\n/)
	const classes: MermaidClass[] = []
	const relations: MermaidRelation[] = []
	let currentClassName: string | undefined
	let currentAttributes: MermaidClassAttribute[] = []
	let currentMethods: MermaidClassMethod[] = []
	let inClassBlock = false

	for (const rawLine of lines) {
		const line = rawLine.trim()
		if (line.length === 0 || line.startsWith('%%')) {
			continue
		}
		if (!inClassBlock && line.startsWith('classDiagram')) {
			continue
		}
		if (!inClassBlock && line.startsWith('class ')) {
			const className = extractClassName(line)
			if (!className) {
				continue
			}
			if (line.endsWith('{')) {
				currentClassName = className
				currentAttributes = []
				currentMethods = []
				inClassBlock = true
				continue
			}
			classes.push({ name: className, attributes: [], methods: [] })
			continue
		}
		if (inClassBlock) {
			if (line === '}') {
				if (currentClassName) {
					classes.push({
						name: currentClassName,
						attributes: currentAttributes,
						methods: currentMethods
					})
				}
				inClassBlock = false
				currentClassName = undefined
				continue
			}
			if (/^[+#~-]?\s*[A-Za-z0-9_]+\s*\([^)]*\)\s*$/.test(line)) {
				const methodName = extractMethodName(line)
				if (methodName) {
					currentMethods.push({ name: methodName, text: line })
				}
				continue
			}
			const attributeName = extractAttributeName(line)
			if (attributeName) {
				currentAttributes.push({
					name: attributeName,
					text: line,
					type: extractAttributeType(line)
				})
			}
			continue
		}
		const relation = parseRelationLine(line)
		if (relation) {
			relations.push(relation)
		}
	}
	if (inClassBlock && currentClassName) {
		classes.push({
			name: currentClassName,
			attributes: currentAttributes,
			methods: currentMethods
		})
	}
	return { classes, relations }
}

function extractClassName(line: string): string | undefined {
	const remainder = line.slice('class'.length).trim()
	if (remainder.length === 0) {
		return undefined
	}
	const clean = remainder.replace('{', '').trim()
	return clean.length > 0 ? clean : undefined
}

function extractAttributeName(text: string): string | undefined {
	const cleaned = text.replace(/^[+#~-]/, '').trim()
	if (cleaned.length === 0) {
		return undefined
	}
	const colonIndex = cleaned.indexOf(':')
	const separatorIndex = colonIndex >= 0 ? colonIndex : cleaned.search(/\s/)
	if (separatorIndex > 0) {
		return cleaned.slice(0, separatorIndex).trim()
	}
	return cleaned
}

function extractAttributeType(text: string): string | undefined {
	const colonIndex = text.indexOf(':')
	if (colonIndex < 0) {
		return undefined
	}
	return text.slice(colonIndex + 1).trim()
}

function extractMethodName(text: string): string | undefined {
	const cleaned = text.replace(/^[+#~-]/, '').trim()
	const parenIndex = cleaned.indexOf('(')
	if (parenIndex <= 0) {
		return cleaned.length > 0 ? cleaned : undefined
	}
	return cleaned.slice(0, parenIndex).trim()
}

function parseRelationLine(line: string): MermaidRelation | undefined {
	const colonIndex = line.indexOf(':')
	const label = colonIndex >= 0 ? line.slice(colonIndex + 1).trim() : undefined
	const content = (colonIndex >= 0 ? line.slice(0, colonIndex) : line)
		.replace(/"[^"]*"/g, '')
		.replace(/\s+/g, ' ')
		.trim()
	if (content.length === 0) {
		return undefined
	}
	const match = content.match(/^([A-Za-z0-9_.$]+)\s*([<|.\-*]+)\s*([A-Za-z0-9_.$]+)$/)
	if (!match) {
		return undefined
	}
	const arrow = match[2]
	if (!arrow.includes('<') && !arrow.includes('>') && !arrow.includes('-')) {
		return undefined
	}
	const type = detectRelationType(arrow)
	const trimmedLabel = label && label.length > 0 ? label : undefined
	return {
		from: match[1],
		to: match[3],
		type,
		label: trimmedLabel
	}
}

function detectRelationType(arrow: string): MermaidRelationType {
	if (arrow.includes('<|') || arrow.includes('|>')) {
		return 'extends'
	}
	if (arrow.includes('o--') || arrow.includes('--o') || arrow.includes('*--') || arrow.includes('--*')) {
		return 'has'
	}
	if (arrow.includes('..>') || arrow.includes('.->') || arrow.includes('-.>')) {
		return 'calls'
	}
	return 'association'
}
