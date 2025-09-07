/**
MIT License

Copyright (c) 2015 - present Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

- https://github.com/microsoft/vscode/blob/main/src/vs/platform/webContentExtractor/test/electron-main/cdpAccessibilityDomain.test.ts

*/

//#region Types

import { Uri as URI } from 'vscode';

export interface AXValue {
	type: AXValueType;
	value?: unknown;
	relatedNodes?: AXNode[];
	sources?: AXValueSource[];
}

export interface AXValueSource {
	type: AXValueSourceType;
	value?: AXValue;
	attribute?: string;
	attributeValue?: string;
	superseded?: boolean;
	nativeSource?: AXValueNativeSourceType;
	nativeSourceValue?: string;
	invalid?: boolean;
	invalidReason?: string;
}

export interface AXNode {
	nodeId: string;
	ignored: boolean;
	ignoredReasons?: AXProperty[];
	role?: AXValue;
	chromeRole?: AXValue;
	name?: AXValue;
	description?: AXValue;
	value?: AXValue;
	properties?: AXProperty[];
	childIds?: string[];
	backendDOMNodeId?: number;
}

export interface AXProperty {
	name: AXPropertyName;
	value: AXValue;
}

export type AXValueType = 'boolean' | 'tristate' | 'booleanOrUndefined' | 'idref' | 'idrefList' | 'integer' | 'node' | 'nodeList' | 'number' | 'string' | 'computedString' | 'token' | 'tokenList' | 'domRelation' | 'role' | 'internalRole' | 'valueUndefined';

export type AXValueSourceType = 'attribute' | 'implicit' | 'style' | 'contents' | 'placeholder' | 'relatedElement';

export type AXValueNativeSourceType = 'description' | 'figcaption' | 'label' | 'labelfor' | 'labelwrapped' | 'legend' | 'rubyannotation' | 'tablecaption' | 'title' | 'other';

export type AXPropertyName = 'url' | 'busy' | 'disabled' | 'editable' | 'focusable' | 'focused' | 'hidden' | 'hiddenRoot' | 'invalid' | 'keyshortcuts' | 'settable' | 'roledescription' | 'live' | 'atomic' | 'relevant' | 'root' | 'autocomplete' | 'hasPopup' | 'level' | 'multiselectable' | 'orientation' | 'multiline' | 'readonly' | 'required' | 'valuemin' | 'valuemax' | 'valuetext' | 'checked' | 'expanded' | 'pressed' | 'selected' | 'activedescendant' | 'controls' | 'describedby' | 'details' | 'errormessage' | 'flowto' | 'labelledby' | 'owns';

//#endregion

export interface AXNodeTree {
	readonly node: AXNode;
	readonly children: AXNodeTree[];
	parent: AXNodeTree | null;
}

export function createNodeTree(nodes: AXNode[]): AXNodeTree | null {
	if (nodes.length === 0) {
		return null;
	}

	// Create a map of node IDs to their corresponding nodes for quick lookup
	const nodeLookup = new Map<string, AXNode>();
	for (const node of nodes) {
		nodeLookup.set(node.nodeId, node);
	}

	// Helper function to get all non-ignored descendants of a node
	function getNonIgnoredDescendants(nodeId: string): string[] {
		const node = nodeLookup.get(nodeId);
		if (!node || !node.childIds) {
			return [];
		}

		const result: string[] = [];
		for (const childId of node.childIds) {
			const childNode = nodeLookup.get(childId);
			if (!childNode) {
				continue;
			}

			if (childNode.ignored) {
				// If child is ignored, add its non-ignored descendants instead
				result.push(...getNonIgnoredDescendants(childId));
			} else {
				// Otherwise, add the child itself
				result.push(childId);
			}
		}
		return result;
	}

	// Create tree nodes only for non-ignored nodes
	const nodeMap = new Map<string, AXNodeTree>();
	for (const node of nodes) {
		if (!node.ignored) {
			nodeMap.set(node.nodeId, { node, children: [], parent: null });
		}
	}

	// Establish parent-child relationships, bypassing ignored nodes
	for (const node of nodes) {
		if (node.ignored) {
			continue;
		}

		const treeNode = nodeMap.get(node.nodeId)!;
		if (node.childIds) {
			for (const childId of node.childIds) {
				const childNode = nodeLookup.get(childId);
				if (!childNode) {
					continue;
				}

				if (childNode.ignored) {
					// If child is ignored, connect its non-ignored descendants to this node
					const nonIgnoredDescendants = getNonIgnoredDescendants(childId);
					for (const descendantId of nonIgnoredDescendants) {
						const descendantTreeNode = nodeMap.get(descendantId);
						if (descendantTreeNode) {
							descendantTreeNode.parent = treeNode;
							treeNode.children.push(descendantTreeNode);
						}
					}
				} else {
					// Normal case: add non-ignored child directly
					const childTreeNode = nodeMap.get(childId);
					if (childTreeNode) {
						childTreeNode.parent = treeNode;
						treeNode.children.push(childTreeNode);
					}
				}
			}
		}
	}

	// Find the root node (a node without a parent)
	for (const node of nodeMap.values()) {
		if (!node.parent) {
			return node;
		}
	}

	return null;
}

/**
 * When possible, we will make sure lines are no longer than 80. This is to help
 * certain pieces of software that can't handle long lines.
 */
const LINE_MAX_LENGTH = 80;

/**
 * Converts an accessibility tree represented by AXNode objects into a markdown string.
 *
 * @param uri The URI of the document
 * @param axNodes The array of AXNode objects representing the accessibility tree
 * @returns A markdown representation of the accessibility tree
 */
export function convertAXTreeToMarkdown(uri: URI, axNodes: AXNode[]): string {
	const tree = createNodeTree(axNodes);
	if (!tree) {
		return ''; // Return empty string for empty tree
	}

	// Process tree to extract main content and navigation links
	const mainContent = extractMainContent(uri, tree);
	const navLinks = collectNavigationLinks(tree);

	// Combine main content and navigation links
	return mainContent + (navLinks.length > 0 ? '\n\n## Additional Links\n' + navLinks.join('\n') : '');
}

function extractMainContent(uri: URI, tree: AXNodeTree): string {
	const contentBuffer: string[] = [];
	processNode(uri, tree, contentBuffer, 0, true);
	return contentBuffer.join('');
}

function processNode(uri: URI, node: AXNodeTree, buffer: string[], depth: number, allowWrap: boolean): void {
	const role = getNodeRole(node.node);

	switch (role) {
		case 'navigation':
			return; // Skip navigation nodes

		case 'heading':
			processHeadingNode(uri, node, buffer, depth);
			return;

		case 'paragraph':
			processParagraphNode(uri, node, buffer, depth, allowWrap);
			return;

		case 'list':
			buffer.push('\n');
			for (const descChild of node.children) {
				processNode(uri, descChild, buffer, depth + 1, true);
			}
			buffer.push('\n');
			return;

		case 'ListMarker':
			// TODO: Should we normalize these ListMarkers to `-` and normal lists?
			buffer.push(getNodeText(node.node, allowWrap));
			return;

		case 'listitem': {
			const tempBuffer: string[] = [];
			// Process the children of the list item
			for (const descChild of node.children) {
				processNode(uri, descChild, tempBuffer, depth + 1, true);
			}
			const indent = getLevel(node.node) > 1 ? ' '.repeat(getLevel(node.node)) : '';
			buffer.push(`${indent}${tempBuffer.join('').trim()}\n`);
			return;
		}

		case 'link':
			if (!isNavigationLink(node)) {
				const linkText = getNodeText(node.node, allowWrap);
				const url = getLinkUrl(node.node);
				if (!isSameUriIgnoringQueryAndFragment(uri, node.node)) {
					buffer.push(`[${linkText}](${url})`);
				} else {
					buffer.push(linkText);
				}
			}
			return;

		case 'MathMLMath': {
			// Convert MathML-like AXNode subtree into a LaTeX-like inline string
			const mathStr = convertMathMLNodeToLatex(node);
			if (mathStr) {
				const lastBuffer = buffer.slice(-2).join('');
				if (lastBuffer.endsWith('\n\n')) {
					// If we are at the start of a new paragraph, use display math
					buffer.push(`$$\n${mathStr}\n$$`);
				} else if (mathStr.startsWith('\\begin')) {
					buffer.push('\n');
					buffer.push(`$$\n${mathStr}\n$$`);
				} else {
					// Otherwise, use inline math
					if (!lastBuffer.endsWith(' ')) {
						buffer.push(' ');
					}
					buffer.push(`$${mathStr}$`);
					buffer.push(' ');
				}
			}
			return;
		}
		case 'StaticText': {
			const staticText = getNodeText(node.node, allowWrap);
			if (staticText) {
				buffer.push(staticText);
			}
			break;
		}
		case 'image': {
			const altText = getNodeText(node.node, allowWrap) || 'Image';
			const imageUrl = getImageUrl(node.node);
			if (imageUrl) {
				buffer.push(`![${altText}](${imageUrl})\n\n`);
			} else {
				buffer.push(`[Image: ${altText}]\n\n`);
			}
			break;
		}

		case 'DescriptionList':
			processDescriptionListNode(uri, node, buffer, depth);
			return;

		case 'blockquote':
			buffer.push('> ' + getNodeText(node.node, allowWrap).replace(/\n/g, '\n> ') + '\n\n');
			break;

		// TODO: Is this the correct way to handle the generic role?
		case 'generic':
			buffer.push(' ');
			break;

		case 'code': {
			processCodeNode(uri, node, buffer, depth);
			return;
		}

		case 'pre':
			buffer.push('```\n' + getNodeText(node.node, false) + '\n```\n\n');
			break;

		case 'table':
			processTableNode(node, buffer);
			return;
		default:
			break;
	}

	// Process children if not already handled in specific cases
	for (const child of node.children) {
		processNode(uri, child, buffer, depth + 1, allowWrap);
	}
}

function getNodeRole(node: AXNode): string {
	return node.role?.value as string || '';
}

function getNodeText(node: AXNode, allowWrap: boolean): string {
	const text = node.name?.value as string || node.value?.value as string || '';
	if (!allowWrap) {
		return text;
	}

	if (text.length <= LINE_MAX_LENGTH) {
		return text;
	}

	const chars = text.split('');
	let lastSpaceIndex = -1;
	for (let i = 1; i < chars.length; i++) {
		if (chars[i] === ' ') {
			lastSpaceIndex = i;
		}
		// Check if we reached the line max length, try to break at the last space
		// before the line max length
		if (i % LINE_MAX_LENGTH === 0 && lastSpaceIndex !== -1) {
			// replace the space with a new line
			chars[lastSpaceIndex] = '\n';
			lastSpaceIndex = i;
		}
	}
	return chars.join('');
}

function getLevel(node: AXNode): number {
	const levelProp = node.properties?.find(p => p.name === 'level');
	return levelProp ? Math.min(Number(levelProp.value.value) || 1, 6) : 1;
}

function getLinkUrl(node: AXNode): string {
	// Find URL in properties
	const urlProp = node.properties?.find(p => p.name === 'url');
	return urlProp?.value.value as string || '#';
}

function getImageUrl(node: AXNode): string | null {
	// Find URL in properties
	const urlProp = node.properties?.find(p => p.name === 'url');
	return urlProp?.value.value as string || null;
}

function isNavigationLink(node: AXNodeTree): boolean {
	// Check if this link is part of navigation
	let current: AXNodeTree | null = node;
	while (current) {
		const role = getNodeRole(current.node);
		if (['navigation', 'menu', 'menubar'].includes(role)) {
			return true;
		}
		current = current.parent;
	}
	return false;
}

function isSameUriIgnoringQueryAndFragment(uri: URI, node: AXNode): boolean {
	// Check if this link is an anchor link
	const link = getLinkUrl(node);
	try {
		const parsed = URI.parse(link);
		return parsed.scheme === uri.scheme && parsed.authority === uri.authority && parsed.path === uri.path;
	} catch {
		return false;
	}
}

function processParagraphNode(uri: URI, node: AXNodeTree, buffer: string[], depth: number, allowWrap: boolean): void {
	buffer.push('\n');
	// Process the children of the paragraph
	for (const child of node.children) {
		processNode(uri, child, buffer, depth + 1, allowWrap);
	}
	buffer.push('\n\n');
}

function processHeadingNode(uri: URI, node: AXNodeTree, buffer: string[], depth: number): void {
	buffer.push('\n');
	const level = getLevel(node.node);
	buffer.push(`${'#'.repeat(level)} `);
	// Process children nodes of the heading
	for (const child of node.children) {
		if (getNodeRole(child.node) === 'StaticText') {
			buffer.push(getNodeText(child.node, false));
		} else {
			processNode(uri, child, buffer, depth + 1, false);
		}
	}
	buffer.push('\n\n');
}

function processDescriptionListNode(uri: URI, node: AXNodeTree, buffer: string[], depth: number): void {
	buffer.push('\n');

	// Process each child of the description list
	for (const child of node.children) {
		if (getNodeRole(child.node) === 'term') {
			buffer.push('- **');
			// Process term nodes
			for (const termChild of child.children) {
				processNode(uri, termChild, buffer, depth + 1, true);
			}
			buffer.push('** ');
		} else if (getNodeRole(child.node) === 'definition') {
			// Process description nodes
			for (const descChild of child.children) {
				processNode(uri, descChild, buffer, depth + 1, true);
			}
			buffer.push('\n');
		}
	}

	buffer.push('\n');
}


export function processTableNode(node: AXNodeTree, buffer: string[]): void {
	buffer.push('\n');

	const rows: AXNodeTree[] = [];
	for (const c of node.children) {
		const role = getNodeRole(c.node);
		if (role === 'row') {
			rows.push(c);
		}
		for (const cc of c.children) {
			const ccrole = getNodeRole(cc.node);
			if (ccrole === 'row') {
				rows.push(cc);
			}
		}
	}

	if (rows.length > 0) {
		const isColumnHeader = (c: AXNodeTree) => {
			const rr = getNodeRole(c.node);
			return rr === 'columnheader';
		}
		let headerRowIndex = rows.findIndex(r => r.children.some(isColumnHeader));
		if (headerRowIndex === -1) {
			headerRowIndex = 0;
		}
		const headerCells = rows[headerRowIndex].children.filter(isColumnHeader);

		// Generate header row
		const headerContent = headerCells.map(cell => getNodeText(cell.node, false) || ' ');
		buffer.push('| ' + headerContent.join(' | ') + ' |\n');

		// Generate separator row
		buffer.push('| ' + headerCells.map(() => '---').join(' | ') + ' |\n');
		// Generate data rows: include all rows except the chosen header row
		for (let i = 0; i < rows.length; i++) {
			if (i === headerRowIndex) {
				continue;
			}
			const dataCells = rows[i].children.filter(cell => {
				const role = getNodeRole(cell.node);
				return role === 'cell' || role === 'rowheader';
			})
			const rowContent = dataCells.map(cell => getNodeText(cell.node, false) || ' ');
			buffer.push('| ' + rowContent.join(' | ') + ' |\n');
		}
	}

	buffer.push('\n');
}

function processCodeNode(uri: URI, node: AXNodeTree, buffer: string[], depth: number): void {
	const tempBuffer: string[] = [];
	// Process the children of the code node
	for (const child of node.children) {
		processNode(uri, child, tempBuffer, depth + 1, false);
	}
	const isCodeblock = tempBuffer.some(text => text.includes('\n'));
	if (isCodeblock) {
		buffer.push('\n```\n');
		// Append the processed text to the buffer
		buffer.push(tempBuffer.join(''));
		buffer.push('\n```\n');
	} else {
		buffer.push('`');
		let characterCount = 0;
		// Append the processed text to the buffer
		for (const tempItem of tempBuffer) {
			characterCount += tempItem.length;
			if (characterCount > LINE_MAX_LENGTH) {
				buffer.push('\n');
				characterCount = 0;
			}
			buffer.push(tempItem);
			buffer.push('`');
		}
	}
}

function collectNavigationLinks(tree: AXNodeTree): string[] {
	const links: string[] = [];
	collectLinks(tree, links);
	return links;
}

function collectLinks(node: AXNodeTree, links: string[]): void {
	const role = getNodeRole(node.node);

	if (role === 'link' && isNavigationLink(node)) {
		const linkText = getNodeText(node.node, true);
		const url = getLinkUrl(node.node);
		const description = node.node.description?.value as string || '';

		links.push(`- [${linkText}](${url})${description ? ' - ' + description : ''}`);
	}

	// Process children
	for (const child of node.children) {
		collectLinks(child, links);
	}
}

//#region MathML to LaTeX Conversion
const latexOpNames = new Set([
	'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
	'log', 'ln', 'exp', 'max', 'min', 'lim', 'limsup', 'liminf', 'sup', 'inf', 'det', 'dim', 'arg', 'argmax', 'argmin'
]);

const latexAccentMap: Record<string, string> = {
	'\u{af}': 'bar',
	'\u{a8}': 'ddot',
	'\u{20db}': 'dddot',
	'^': 'hat',
	'~': 'tilde',
	'\u{2015}': 'overline',
	'`': 'grave',
	'\u{b4}': 'acute',
	'\u{2192}': 'vec', // right arrow
	'\u{2c6}': 'hat',
	'\u{2c7}': 'check',
	'\u{2c9}': 'bar',
	'\u{2ca}': 'acute',
	'\u{2cb}': 'grave',
	'\u{2d8}': 'breve',
	'\u{2d9}': 'dot',
	'\u{2da}': 'ring',
	'\u{2dc}': 'tilde',
	'\u{300}': 'grave',
	'\u{301}': 'acute',
	'\u{302}': 'hat',
	'\u{303}': 'tilde',
	'\u{304}': 'bar',
	'\u{305}': 'bar',
	'\u{306}': 'breve',
	'\u{307}': 'dot',
	'\u{308}': 'ddot',
	'\u{30a}': 'ring',
	'\u{30c}': 'check'
};

let mathmlVisited: Set<string>;

function convertMathMLNodeToLatex(root: AXNodeTree): string {
	mathmlVisited = new Set<string>();
	return recurseMathMLTree(root);
}

function recurseMathMLTree(node: AXNodeTree | undefined): string {
	if (!node || mathmlVisited.has(node.node.nodeId)) {
		return '';
	}
	mathmlVisited.add(node.node.nodeId);

	const role = typeof node.node.role?.value === 'string' ? node.node.role.value : '';
	switch (role) {
		case 'MathMLOperator':
		case 'MathMLIdentifier': {
			let text = node.children.length > 0 ? concatMatMLChildren(node) : getTextFromMathMLNode(node);
			text = text.trim();
			if (latexOpNames.has(text)) {
				return `\\${text}`;
			} else if (/^[a-zA-Z]+$/.test(text) && text.length > 1) {
				return `\\operatorname{${text}}`;
			} else if (['_', '%', '&', '#'].includes(text)) {
				return `\\${text}`;
			} else {
				return text;
			}
		}

		case 'MathMLText': {
			const text = node.children.length > 0 ? concatMatMLChildren(node) : getTextFromMathMLNode(node);
			return `\\text{${text}}`;
		}

		case 'MathMLNumber':
		case 'StaticText':
		case 'InlineTextBox': {
			if (node.children.length > 0) {
				return concatMatMLChildren(node);
			}
			return getTextFromMathMLNode(node);
		}

		case 'MathMLOver': {
			const base = recurseMathMLTree(node.children[0]);
			let cmd = recurseMathMLTree(node.children[1]);
			cmd = cmd.trim();
			let texCmd = latexAccentMap[cmd];
			if (texCmd) {
				if (texCmd === 'hat' && cpLength(base) > 1) {
					texCmd = 'widehat';
				} else if (texCmd === 'check' && cpLength(base) > 1) {
					texCmd = 'widecheck';
				} else if (texCmd === 'tilde' && cpLength(base) > 1) {
					texCmd = 'widetilde';
				}
				return `\\${texCmd}{${base}}`;
			} else {
				return combineBaseSubSup(base, undefined, cmd);
			}
		}

		case 'MathMLSup': {
			const base = recurseMathMLTree(node.children[0]);
			const exp = recurseMathMLTree(node.children[1]);
			return combineBaseSubSup(base, undefined, exp);
		}

		case 'MathMLUnder':
		case 'MathMLSub': {
			const base = recurseMathMLTree(node.children[0]);
			const sub = recurseMathMLTree(node.children[1]);
			return combineBaseSubSup(base, sub);
		}

		case 'MathMLUnderOver':
		case 'MathMLSubSup': {
			const base = recurseMathMLTree(node.children[0]);
			const sub = recurseMathMLTree(node.children[1]);
			const sup = recurseMathMLTree(node.children[2]);
			return combineBaseSubSup(base, sub, sup);
		}

		case 'MathMLFraction': {
			const num = recurseMathMLTree(node.children[0]);
			const den = recurseMathMLTree(node.children[1]);
			return `\\frac{${num}}{${den}}`;
		}

		case 'MathMLSquareRoot': {
			return `\\sqrt{${concatMatMLChildren(node)}}`;
		}

		case 'MathMLRoot': {
			const rad = recurseMathMLTree(node.children[0]);
			const index = recurseMathMLTree(node.children[1]);
			return `\\sqrt[${index}]{${rad}}`;
		}

		case 'MathMLTable': {
			const rows: string[] = [];
			for (const ch of node.children) {
				if (ch.node.role?.value === 'MathMLTableRow') {
					rows.push(concatMatMLChildren(ch));
				}
			}
			return `\\begin{align*}\n${rows.join(' \\\\\n')}\n\\end{align*}`;
		}

		case 'MathMLRow': {
			const out: string[] = [];
			for (let i = 0; i < node.children.length; i++) {
				const child = node.children[i];
				const child1 = node.children[i + 1];
				const child2 = node.children[i + 2];
				const envResult = extractMatrixLikeEnv(child, child1, child2);
				if (envResult) {
					if (envResult.isMatrix) {
						out.push(renderLatexMatrix(child1, envResult.env));
					} else {
						out.push(envResult.op);
						out.push(recurseMathMLTree(child1));
						out.push(envResult.cl);
					}
					i += 2;
				} else {
					const childText = recurseMathMLTree(child);
					const lastText = out.slice(-1)[0];
					if (lastText?.match(/^\\[a-zA-Z]+$/) && childText.match(/^[a-zA-Z]/)) {
						out.push(' '); // add space to separate operator from identifier
					}
					if (childText !== '') {
						out.push(childText);
					}
				}
			}
			return out.join('');
		}

		case 'MathMLMath':
		default: {
			return concatMatMLChildren(node);
		}
	}
}

function normalizeMathIdentifier(text: string): string {
	if (text === '') {
		return text;
	}
	const normalized = text.normalize('NFKC');
	if (/^[\u{1D434}-\u{1D467}]+$/gu.test(text)) {
		// Convert Mathematical Italic letters to ASCIIs
		text = normalized;
	} else if (!/^[a-zA-Z]+$/.test(normalized)) {
		// Normalize mathematical symobols
		text = normalized;
	}
	text = text.replace(/\u{2212}/gu, '-') // minus sign → ASCII hyphen
		.replace(/[\u{2061}\u{2062}\u{2063}\u{2064}]/gu, '')
	// remove the follwoing
	// - invisible function application symbol
	// - invisible times
	// - invisible separator
	// - invisible plus
	return text;
}

function getTextFromMathMLNode(n: AXNodeTree): string {
	const text = typeof n.node.name?.value === 'string' ? n.node.name.value : '';
	return normalizeMathIdentifier(text);
}

function concatMatMLChildren(n: AXNodeTree): string {
	const out: string[] = [];
	for (const child of n.children) {
		const childText = recurseMathMLTree(child);
		const lastText = out.slice(-1)[0];
		if (lastText?.match(/^\\[a-zA-Z]+$/) && childText.match(/^[a-zA-Z]/)) {
			out.push(' '); // add space to separate operator from identifier
		}
		if (childText !== '') {
			out.push(childText);
		}
	};
	return out.join('')
}

/**
 * Get the length of a string in terms of Unicode code points
 */
function cpLength(text: string): number {
	return [...text].length;
}

function combineBaseSubSup(base: string, sub: string | undefined = '', sup: string | undefined = ''): string {
	if (cpLength(base) !== 1 && !/^\\[a-zA-Z]+$/.test(base)) {
		base = `{${base}}`;
	}
	if (sub) {
		if (cpLength(sub) === 1) {
			sub = `_${sub}`;
		} else {
			sub = `_{${sub}}`;
		}

	}
	if (sup) {
		if (cpLength(sup) === 1) {
			sup = `^${sup}`;
		} else {
			sup = `^{${sup}}`;
		}
	}
	return base + sub + sup;
}

function extractMatrixLikeEnv(child: AXNodeTree, child1: AXNodeTree | undefined, child2: AXNodeTree | undefined) {
	const result = child.node.role?.value === 'MathMLOperator' && child1?.node.role?.value === 'MathMLTable' && child2?.node.role?.value === 'MathMLOperator';
	if (!result) {
		return undefined;
	}
	const op = recurseMathMLTree(child);
	const cl = recurseMathMLTree(child2);
	if (op === '(' && cl === ')') {
		return { op, cl, env: 'pmatrix', isMatrix: true };
	} else if (op === '|' && cl === '|') {
		return { op, cl, env: 'vmatrix', isMatrix: true };
	} else if (['\u{2016}', '\u{2225}'].includes(op) && ['\u{2016}', '\u{2225}'].includes(cl)) { // double vertical line or parallel to.
		return { op, cl, env: 'Vmatrix', isMatrix: true };
	} else if (op === '[' && cl === ']') {
		return { op, cl, env: 'bmatrix', isMatrix: true };
	} else if (op === '{' && cl === '}') {
		return { op, cl, env: 'Bmatrix', isMatrix: true };
	} else if (op === '{' && cl === '') {
		return { op, cl, env: 'cases', isMatrix: true };
	} else if (cpLength(op) === 1 && cpLength(cl) === 1) {
		return { op, cl, env: 'matrix', isMatrix: true };
	} else {
		return { op, cl, env: 'align*', isMatrix: false };
	}
}

function renderLatexMatrix(child1: AXNodeTree, env: string): string {
	if (child1.node.role?.value !== 'MathMLTable') {
		return '';
	}
	const rows: string[] = [];
	for (const ch of child1.children) {
		if (ch.node.role?.value === 'MathMLTableRow') {
			const cells = ch.children.map(cellChild => recurseMathMLTree(cellChild));
			rows.push(cells.join(' & '));
		}
	}
	return `\\begin{${env}}\n${rows.join(' \\\\\n')}\n\\end{${env}}`;
};
//#endregion MathML to LaTeX Conversion
