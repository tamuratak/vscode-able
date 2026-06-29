/**
 * Utility functions for apply_patch parsing.
 *
 * Contains string helpers, Levenshtein distance computation,
 * indentation utilities, and file identification functions.
 * All functions are standalone with no VS Code dependencies.
 */

import {
	ADD_FILE_PREFIX,
	DELETE_FILE_PREFIX,
	IGuessedIndentation,
	MOVE_FILE_TO_PREFIX,
	UPDATE_FILE_PREFIX,
} from './types.js'

// -----------------------------------------------------------------------------
// String helpers (ported from vscode strings.ts)
// -----------------------------------------------------------------------------

export function isFalsyOrWhitespace(str: string | undefined): boolean {
	if (!str || typeof str !== 'string') {
		return true
	}
	return str.trim().length === 0
}

/**
 * Counts how often `substr` occurs inside `value`.
 */
export function count(value: string, substr: string): number {
	let result = 0
	let index = value.indexOf(substr)
	while (index !== -1) {
		result++
		index = value.indexOf(substr, index + substr.length)
	}
	return result
}

/**
 * Returns first index of the string that is not whitespace.
 * If string is empty or contains only whitespaces, returns -1
 */
export function firstNonWhitespaceIndex(str: string): number {
	for (let i = 0, len = str.length; i < len; i++) {
		const chCode = str.charCodeAt(i)
		if (chCode !== 32 /* Space */ && chCode !== 9 /* Tab */) {
			return i
		}
	}
	return -1
}

// -----------------------------------------------------------------------------
// Levenshtein distance (ported from vscode diff.ts)
// -----------------------------------------------------------------------------

const precomputedEqualityArray = new Uint32Array(0x10000)

const computeLevenshteinDistanceForShortStrings = (
	firstString: string,
	secondString: string,
): number => {
	const firstStringLength = firstString.length
	const secondStringLength = secondString.length
	const lastBitMask = 1 << (firstStringLength - 1)
	let positiveVector = -1
	let negativeVector = 0
	let distance = firstStringLength
	let index = firstStringLength

	while (index--) {
		precomputedEqualityArray[firstString.charCodeAt(index)] |= 1 << index
	}

	for (index = 0; index < secondStringLength; index++) {
		let equalityMask = precomputedEqualityArray[secondString.charCodeAt(index)]
		const combinedVector = equalityMask | negativeVector
		equalityMask |=
			((equalityMask & positiveVector) + positiveVector) ^ positiveVector
		negativeVector |= ~(equalityMask | positiveVector)
		positiveVector &= equalityMask
		if (negativeVector & lastBitMask) {
			distance++
		}
		if (positiveVector & lastBitMask) {
			distance--
		}
		negativeVector = (negativeVector << 1) | 1
		positiveVector =
			(positiveVector << 1) | ~(combinedVector | negativeVector)
		negativeVector &= combinedVector
	}

	index = firstStringLength
	while (index--) {
		precomputedEqualityArray[firstString.charCodeAt(index)] = 0
	}

	return distance
}

function computeLevenshteinDistanceForLongStrings(
	firstString: string,
	secondString: string,
): number {
	const firstStringLength = firstString.length
	const secondStringLength = secondString.length
	const horizontalBitArray: number[] = []
	const verticalBitArray: number[] = []
	const horizontalSize = Math.ceil(firstStringLength / 32)
	const verticalSize = Math.ceil(secondStringLength / 32)

	for (let i = 0; i < horizontalSize; i++) {
		horizontalBitArray[i] = -1
		verticalBitArray[i] = 0
	}

	let verticalIndex = 0
	for (; verticalIndex < verticalSize - 1; verticalIndex++) {
		let negativeVector = 0
		let positiveVector = -1
		const start = verticalIndex * 32
		const verticalLength = Math.min(32, secondStringLength) + start

		for (let k = start; k < verticalLength; k++) {
			precomputedEqualityArray[secondString.charCodeAt(k)] |= 1 << k
		}

		for (let i = 0; i < firstStringLength; i++) {
			const equalityMask =
				precomputedEqualityArray[firstString.charCodeAt(i)]
			const previousBit =
				(horizontalBitArray[(i / 32) | 0] >>> i) & 1
			const matchBit = (verticalBitArray[(i / 32) | 0] >>> i) & 1
			const combinedVector = equalityMask | negativeVector
			const combinedHorizontalVector =
				((((equalityMask | matchBit) & positiveVector) +
					positiveVector) ^
					positiveVector) |
				equalityMask |
				matchBit
			let positiveHorizontalVector =
				negativeVector | ~(combinedHorizontalVector | positiveVector)
			let negativeHorizontalVector =
				positiveVector & combinedHorizontalVector
			if ((positiveHorizontalVector >>> 31) ^ previousBit) {
				horizontalBitArray[(i / 32) | 0] ^= 1 << i
			}
			if ((negativeHorizontalVector >>> 31) ^ matchBit) {
				verticalBitArray[(i / 32) | 0] ^= 1 << i
			}
			positiveHorizontalVector =
				(positiveHorizontalVector << 1) | previousBit
			negativeHorizontalVector =
				(negativeHorizontalVector << 1) | matchBit
			positiveVector =
				negativeHorizontalVector |
				~(combinedVector | positiveHorizontalVector)
			negativeVector =
				positiveHorizontalVector & combinedVector
		}

		for (let k = start; k < verticalLength; k++) {
			precomputedEqualityArray[secondString.charCodeAt(k)] = 0
		}
	}

	let negativeVector = 0
	let positiveVector = -1
	const start = verticalIndex * 32
	const verticalLength =
		Math.min(32, secondStringLength - start) + start

	for (let k = start; k < verticalLength; k++) {
		precomputedEqualityArray[secondString.charCodeAt(k)] |= 1 << k
	}

	let distance = secondStringLength

	for (let i = 0; i < firstStringLength; i++) {
		const equalityMask =
			precomputedEqualityArray[firstString.charCodeAt(i)]
		const previousBit =
			(horizontalBitArray[(i / 32) | 0] >>> i) & 1
		const matchBit = (verticalBitArray[(i / 32) | 0] >>> i) & 1
		const combinedVector = equalityMask | negativeVector
		const combinedHorizontalVector =
			((((equalityMask | matchBit) & positiveVector) +
				positiveVector) ^
				positiveVector) |
			equalityMask |
			matchBit
		let positiveHorizontalVector =
			negativeVector | ~(combinedHorizontalVector | positiveVector)
		let negativeHorizontalVector =
			positiveVector & combinedHorizontalVector
		distance += (positiveHorizontalVector >>> (secondStringLength - 1)) & 1
		distance -= (negativeHorizontalVector >>> (secondStringLength - 1)) & 1
		if ((positiveHorizontalVector >>> 31) ^ previousBit) {
			horizontalBitArray[(i / 32) | 0] ^= 1 << i
		}
		if ((negativeHorizontalVector >>> 31) ^ matchBit) {
			verticalBitArray[(i / 32) | 0] ^= 1 << i
		}
		positiveHorizontalVector =
			(positiveHorizontalVector << 1) | previousBit
		negativeHorizontalVector =
			(negativeHorizontalVector << 1) | matchBit
		positiveVector =
			negativeHorizontalVector |
			~(combinedVector | positiveHorizontalVector)
		negativeVector = positiveHorizontalVector & combinedVector
	}

	for (let k = start; k < verticalLength; k++) {
		precomputedEqualityArray[secondString.charCodeAt(k)] = 0
	}

	return distance
}

export function computeLevenshteinDistance(
	firstString: string,
	secondString: string,
): number {
	if (firstString.length < secondString.length) {
		const temp = secondString
		secondString = firstString
		firstString = temp
	}
	if (secondString.length === 0) {
		return firstString.length
	}
	if (firstString.length <= 32) {
		return computeLevenshteinDistanceForShortStrings(
			firstString,
			secondString,
		)
	}
	return computeLevenshteinDistanceForLongStrings(firstString, secondString)
}

// -----------------------------------------------------------------------------
// Indentation utilities (ported from vscode indentationGuesser.ts)
// -----------------------------------------------------------------------------

interface SpacesDiffResult {
	spacesDiff: number
	looksLikeAlignment: boolean
}

function spacesDiff(
	a: string,
	aLength: number,
	b: string,
	bLength: number,
	result: SpacesDiffResult,
): void {
	result.spacesDiff = 0
	result.looksLikeAlignment = false

	let i: number
	for (i = 0; i < aLength && i < bLength; i++) {
		const aCharCode = a.charCodeAt(i)
		const bCharCode = b.charCodeAt(i)
		if (aCharCode !== bCharCode) {
			break
		}
	}

	let aSpacesCnt = 0
	let aTabsCount = 0
	for (let j = i; j < aLength; j++) {
		if (a.charCodeAt(j) === 32 /* Space */) {
			aSpacesCnt++
		} else {
			aTabsCount++
		}
	}

	let bSpacesCnt = 0
	let bTabsCount = 0
	for (let j = i; j < bLength; j++) {
		if (b.charCodeAt(j) === 32 /* Space */) {
			bSpacesCnt++
		} else {
			bTabsCount++
		}
	}

	if (aSpacesCnt > 0 && aTabsCount > 0) {
		return
	}
	if (bSpacesCnt > 0 && bTabsCount > 0) {
		return
	}

	const tabsDiff = Math.abs(aTabsCount - bTabsCount)
	const spacesDiffVal = Math.abs(aSpacesCnt - bSpacesCnt)

	if (tabsDiff === 0) {
		result.spacesDiff = spacesDiffVal
		if (
			spacesDiffVal > 0 &&
			0 <= bSpacesCnt - 1 &&
			bSpacesCnt - 1 < a.length &&
			bSpacesCnt < b.length
		) {
			if (
				b.charCodeAt(bSpacesCnt) !== 32 &&
				a.charCodeAt(bSpacesCnt - 1) === 32
			) {
				if (a.charCodeAt(a.length - 1) === 44 /* Comma */) {
					result.looksLikeAlignment = true
				}
			}
		}
		return
	}
	if (spacesDiffVal % tabsDiff === 0) {
		result.spacesDiff = spacesDiffVal / tabsDiff
		return
	}
}

export function guessIndentation(
	source: string[],
	defaultTabSize: number,
	defaultInsertSpaces: boolean,
): IGuessedIndentation {
	const linesCount = Math.min(source.length, 10000)

	let linesIndentedWithTabsCount = 0
	let linesIndentedWithSpacesCount = 0

	let previousLineText = ''
	let previousLineIndentation = 0

	const ALLOWED_TAB_SIZE_GUESSES = [2, 4, 6, 8, 3, 5, 7]
	const MAX_ALLOWED_TAB_SIZE_GUESS = 8

	const spacesDiffCount = [0, 0, 0, 0, 0, 0, 0, 0, 0]
	const tmp: SpacesDiffResult = { spacesDiff: 0, looksLikeAlignment: false }

	for (let lineNumber = 0; lineNumber < linesCount; lineNumber++) {
		const currentLineText = source[lineNumber]
		const currentLineLength = currentLineText.length

		let currentLineHasContent = false
		let currentLineIndentation = 0
		let currentLineSpacesCount = 0
		let currentLineTabsCount = 0
		for (let j = 0; j < currentLineLength; j++) {
			const charCode = currentLineText.charCodeAt(j)
			if (charCode === 9 /* Tab */) {
				currentLineTabsCount++
			} else if (charCode === 32 /* Space */) {
				currentLineSpacesCount++
			} else {
				currentLineHasContent = true
				currentLineIndentation = j
				break
			}
		}

		if (!currentLineHasContent) {
			continue
		}

		if (currentLineTabsCount > 0) {
			linesIndentedWithTabsCount++
		} else if (currentLineSpacesCount > 1) {
			linesIndentedWithSpacesCount++
		}

		spacesDiff(
			previousLineText,
			previousLineIndentation,
			currentLineText,
			currentLineIndentation,
			tmp,
		)

		if (tmp.looksLikeAlignment) {
			if (
				!(defaultInsertSpaces && defaultTabSize === tmp.spacesDiff)
			) {
				continue
			}
		}

		const currentSpacesDiff = tmp.spacesDiff
		if (currentSpacesDiff <= MAX_ALLOWED_TAB_SIZE_GUESS) {
			spacesDiffCount[currentSpacesDiff]++
		}

		previousLineText = currentLineText
		previousLineIndentation = currentLineIndentation
	}

	let insertSpaces = defaultInsertSpaces
	if (linesIndentedWithTabsCount !== linesIndentedWithSpacesCount) {
		insertSpaces = linesIndentedWithTabsCount < linesIndentedWithSpacesCount
	}

	let tabSize = defaultTabSize

	if (insertSpaces) {
		let tabSizeScore = insertSpaces ? 0 : 0.1 * linesCount
		for (const possibleTabSize of ALLOWED_TAB_SIZE_GUESSES) {
			const possibleTabSizeScore = spacesDiffCount[possibleTabSize]
			if (possibleTabSizeScore > tabSizeScore) {
				tabSizeScore = possibleTabSizeScore
				tabSize = possibleTabSize
			}
		}

		if (
			tabSize === 4 &&
			spacesDiffCount[4] > 0 &&
			spacesDiffCount[2] > 0 &&
			spacesDiffCount[2] >= spacesDiffCount[4] / 2
		) {
			tabSize = 2
		}
	}

	return { insertSpaces, tabSize }
}

function computeIndentLevel(line: string, tabSize: number): number {
	let indent = 0
	let i = 0
	const len = line.length

	while (i < len) {
		const chCode = line.charCodeAt(i)
		if (chCode === 32 /* Space */) {
			indent++
		} else if (chCode === 9 /* Tab */) {
			indent = indent - (indent % tabSize) + tabSize
		} else {
			break
		}
		i++
	}

	if (i === len) {
		return ~indent
	}

	return indent
}

export function computeIndentLevel2(
	line: string,
	tabSize: number,
): number {
	const result = computeIndentLevel(line, tabSize)
	if (result < 0) {
		return Math.floor(~result / tabSize)
	}
	return Math.floor(result / tabSize)
}

function nextIndentTabStop(
	visibleColumn: number,
	indentSize: number,
): number {
	return visibleColumn + indentSize - (visibleColumn % indentSize)
}

function normalizeIndentationFromWhitespace(
	str: string,
	indentSize: number,
	insertSpaces: boolean,
): string {
	let spacesCnt = 0
	for (let i = 0; i < str.length; i++) {
		if (str.charAt(i) === '\t') {
			spacesCnt = nextIndentTabStop(spacesCnt, indentSize)
		} else {
			spacesCnt++
		}
	}

	let result = ''
	if (!insertSpaces) {
		const tabsCnt = Math.floor(spacesCnt / indentSize)
		spacesCnt = spacesCnt % indentSize
		for (let i = 0; i < tabsCnt; i++) {
			result += '\t'
		}
	}

	for (let i = 0; i < spacesCnt; i++) {
		result += ' '
	}

	return result
}

export function normalizeIndentation(
	str: string,
	indentSize: number,
	insertSpaces: boolean,
): string {
	let fnwi = firstNonWhitespaceIndex(str)
	if (fnwi === -1) {
		fnwi = str.length
	}
	return (
		normalizeIndentationFromWhitespace(
			str.substring(0, fnwi),
			indentSize,
			insertSpaces,
		) + str.substring(fnwi)
	)
}

export function getIndentationChar(indentation: IGuessedIndentation): string {
	if (indentation.insertSpaces) {
		return ' '.repeat(indentation.tabSize)
	}
	return '\t'
}

export function transformIndentation(
	content: string,
	fromIndent: IGuessedIndentation,
	toIndent: IGuessedIndentation,
): string {
	if (
		fromIndent.insertSpaces === toIndent.insertSpaces &&
		fromIndent.tabSize === toIndent.tabSize
	) {
		return content
	}

	const fromChr = getIndentationChar(fromIndent)
	const toChr = getIndentationChar(toIndent)

	const lines = content.split('\n')
	for (let i = 0; i < lines.length; i++) {
		let k = 0
		while (lines[i].slice(k, k + fromChr.length) === fromChr) {
			k += fromChr.length
		}

		lines[i] = toChr.repeat(k / fromChr.length) + lines[i].slice(k)
	}

	return lines.join('\n')
}

// -----------------------------------------------------------------------------
// Code block fence stripping
// -----------------------------------------------------------------------------

const FENCE_PATTERN = /^(`{3,}|~{3,})(\w*)\s*$/

/**
 * Strip code block fences from the text.
 *
 * Handles these cases:
 * - Both opening and closing fences present: strips both + adjacent empty lines
 * - Opening fence only (no closing): strips opening + adjacent empty line, rest is content
 * - No fences: returns text as-is
 *
 * @throws {Error} if the content is empty after stripping fences
 */
export function stripCodeBlockFences(text: string): string {
	const lines = text.split('\n')
	let start = 0
	let end = lines.length

	// Strip opening fence
	if (start < end && FENCE_PATTERN.test(lines[start])) {
		start++
		// Strip adjacent empty line after opening fence
		if (start < end && lines[start] === '') {
			start++
		}
	}

	// Strip closing fence (only if present)
	if (end > start && FENCE_PATTERN.test(lines[end - 1])) {
		end--
		// Strip adjacent empty line before closing fence
		if (end > start && lines[end - 1] === '') {
			end--
		}
	}

	const result = lines.slice(start, end).join('\n').trim()
	if (result.length === 0) {
		throw new Error('Patch text is empty after removing code block fences')
	}
	return result
}

// -----------------------------------------------------------------------------
// Filepath comment helpers
// -----------------------------------------------------------------------------

const HASH_COMMENT_EXTENSIONS =
	/\.(py|rb|pl|sh|bash|zsh|fish|yaml|yml|toml|ini|cfg|conf|cmake|r|R|jl|hs|elm)$/i

/**
 * Generate a filepath comment line for the given file path.
 * Uses `//` for most files, `#` for shell scripts and similar.
 */
export function getFilepathComment(filePath: string): string {
	const useHash = HASH_COMMENT_EXTENSIONS.test(filePath.trimEnd())
	if (useHash) {
		return `# filepath: ${filePath}\n`
	}
	return `// filepath: ${filePath}\n`
}

// -----------------------------------------------------------------------------
// File identification utilities
// -----------------------------------------------------------------------------

export function identifyFilesAffected(text: string): string[] {
	const lines = text.trim().split('\n')
	const result = new Set<string>()
	for (const line of lines) {
		if (line.startsWith(UPDATE_FILE_PREFIX)) {
			result.add(line.slice(UPDATE_FILE_PREFIX.length))
		} else if (line.startsWith(DELETE_FILE_PREFIX)) {
			result.add(line.slice(DELETE_FILE_PREFIX.length))
		} else if (line.startsWith(MOVE_FILE_TO_PREFIX)) {
			result.add(line.slice(MOVE_FILE_TO_PREFIX.length))
		} else if (line.startsWith(ADD_FILE_PREFIX)) {
			result.add(line.slice(ADD_FILE_PREFIX.length))
		}
	}
	return [...result]
}

export function identifyFilesNeeded(text: string): string[] {
	const lines = text.trim().split('\n')
	const result = new Set<string>()
	for (const line of lines) {
		if (line.startsWith(UPDATE_FILE_PREFIX)) {
			result.add(line.slice(UPDATE_FILE_PREFIX.length))
		}
		if (line.startsWith(DELETE_FILE_PREFIX)) {
			result.add(line.slice(DELETE_FILE_PREFIX.length))
		}
	}
	return [...result]
}

export function identifyFilesAdded(text: string): string[] {
	const lines = text.trim().split('\n')
	const result = new Set<string>()
	for (const line of lines) {
		if (line.startsWith(ADD_FILE_PREFIX)) {
			result.add(line.slice(ADD_FILE_PREFIX.length))
		}
	}
	return [...result]
}
