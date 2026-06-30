/**
 * OpenAI apply_patch format parser.
 *
 * Parses patch text in the "apply_patch" format used by OpenAI models
 * and produces structured Patch objects. Supports fuzzy context matching
 * to handle model imperfections (trailing whitespace, Unicode variants,
 * Levenshtein distance, explicit tab/newline normalization).
 *
 * Based on the reference implementation from VS Code / OpenAI Codex.
 * This is a standalone library with no VS Code dependencies.
 *
 * @example
 * ```ts
 * const patchText = [
 *   '*** Begin Patch',
 *   '*** Update File: src/main.ts',
 *   '@@',
 *   ' function hello() {',
 *   '-  console.log("old")',
 *   '+  console.log("new")',
 *   ' }',
 *   '*** End Patch',
 * ].join('\n')
 *
 * const existingFiles = { 'src/main.ts': 'function hello() {\n  console.log("old")\n}\n' }
 * const [patch, fuzz] = textToPatch(patchText, existingFiles)
 * ```
 */

import { DiffError, Fuzz, FuzzMatch, IGuessedIndentation, InvalidContextError, InvalidPatchFormatError, Patch, PatchAction, ActionType, Chunk, Commit } from './types.js'
import {
	ADD_FILE_PREFIX,
	DELETE_FILE_PREFIX,
	END_OF_FILE_PREFIX,
	HUNK_ADD_LINE_PREFIX,
	HUNK_DELETE_LINE_PREFIX,
	MOVE_FILE_TO_PREFIX,
	PATCH_PREFIX,
	PATCH_SUFFIX,
	UPDATE_FILE_PREFIX,
} from './types.js'
import {
	computeLevenshteinDistance,
	count,
	getFilepathComment,
	getIndentationChar,
	guessIndentation,

	isFalsyOrWhitespace,
	transformIndentation,
	computeIndentLevel2,
} from './utils.js'

const CHUNK_DELIMITER = '@@'

// Max edit distance allowed per line for fuzzy matching context.
// Models occasionally 'forget' a character in a diff, and this allows
// those to still match in conservative cases.
const EDIT_DISTANCE_ALLOWANCE_PER_LINE = 0.34

// GPT models have some tendency to forget to escape \t, \r, \n, and such in
// their edits. Generally we're somewhat aggressive about normalizing these
// when they lead a line. The following are a list of language/file extensions
// where we don't do this because they are common operators,
// such as `\textbf{}` in LaTeX.
const AVOID_EXPLICIT_TABS_REGEX = /\.(tex|latex|sty|cls|bib|bst|ins)$/i

// -----------------------------------------------------------------------------
// Unicode punctuation normalisation
// -----------------------------------------------------------------------------

const PUNCT_EQUIV: Record<string, string> = {
	// Hyphen / dash variants
	'-': '-',
	'\u2010': '-',
	'\u2011': '-',
	'\u2012': '-',
	'\u2013': '-',
	'\u2014': '-',
	'\u2212': '-',
	// Double quotes
	'\u0022': '"',
	'\u201C': '"',
	'\u201D': '"',
	'\u201E': '"',
	'\u00AB': '"',
	'\u00BB': '"',
	// Single quotes
	'\u0027': '\u0027',
	'\u2018': '\u0027',
	'\u2019': '\u0027',
	'\u201B': '\u0027',
	// Spaces
	'\u00A0': ' ',
	'\u202F': ' ',
}

const canon = (s: string): string =>
	s.normalize('NFC').replace(/./gu, (c) => PUNCT_EQUIV[c] ?? c)

// -----------------------------------------------------------------------------
// Explicit tab / newline normalization
// -----------------------------------------------------------------------------

export function replaceExplicitTabs(s: string): string {
	return s.replace(/^(?:\s|\\t|\/|#)*/gm, (r) =>
		r.replaceAll('\\t', '\t'),
	)
}

export function replaceExplicitNl(s: string): string {
	return replaceExplicitTabs(s.replaceAll('\\n', '\n'))
}

// -----------------------------------------------------------------------------
// Context matching
// -----------------------------------------------------------------------------

function findContextCore(
	lines: string[],
	context: string[],
	start: number,
): { line: number; fuzz: Fuzz; indent?: string } | undefined {
	if (context.length === 0) {
		return { line: start, fuzz: Fuzz.None }
	}

	// Pass 1 – exact equality after canonicalisation
	const ctxPass1 = canon(context.join('\n'))
	const workingLines = lines.map(canon)
	for (let i = start; i < workingLines.length; i++) {
		const segment = workingLines.slice(i, i + context.length).join('\n')
		if (segment === ctxPass1) {
			return { line: i, fuzz: Fuzz.None }
		}
	}

	// Pass 2 – ignore trailing whitespace
	const ctxPass2 = ctxPass1
		.split('\n')
		.map((l) => l.trimEnd())
		.join('\n')
	let fuzz = Fuzz.IgnoredTrailingWhitespace
	for (let i = start; i < workingLines.length; i++) {
		workingLines[i] = workingLines[i].trimEnd()
	}
	for (let i = start; i < lines.length; i++) {
		if (
			workingLines.slice(i, i + context.length).join('\n') === ctxPass2
		) {
			return { line: i, fuzz }
		}
	}

	// Pass 3 – normalize explicit \\t tab chars
	const ctxPass3 = replaceExplicitTabs(ctxPass2)
	if (ctxPass3 !== ctxPass2) {
		fuzz |= Fuzz.NormalizedExplicitTab
		for (let i = start; i < lines.length; i++) {
			if (
				workingLines.slice(i, i + context.length).join('\n') ===
				ctxPass3
			) {
				return { line: i, fuzz }
			}
		}
	}

	// Pass 4 – normalize explicit \\t and \\n chars
	if (context.length === 1) {
		const ctxPass4 = replaceExplicitNl(ctxPass3)
		if (ctxPass4 !== ctxPass3) {
			const newContextLines = count(ctxPass4, '\n') + 1
			for (let i = start; i < lines.length; i++) {
				if (
					workingLines.slice(i, i + newContextLines).join('\n') ===
					ctxPass4
				) {
					return {
						line: i,
						fuzz:
							fuzz |
							Fuzz.NormalizedExplicitNL |
							Fuzz.NormalizedExplicitTab,
					}
				}
			}
		}
	}

	// Pass 5 – ignore all surrounding whitespace
	const ctxPass5 = ctxPass3
		.split('\n')
		.map((l) => l.trim())
		.join('\n')
	fuzz |= Fuzz.IgnoredWhitespace
	for (let i = start; i < workingLines.length; i++) {
		workingLines[i] = workingLines[i].trimStart()
	}
	for (let i = start; i < lines.length; i++) {
		if (
			workingLines.slice(i, i + context.length).join('\n') === ctxPass5
		) {
			return { line: i, fuzz, indent: workingLines[i] }
		}
	}

	// Pass 6 – within edit distance while ignoring surrounding whitespace
	const maxDistance = Math.floor(
		context.length * EDIT_DISTANCE_ALLOWANCE_PER_LINE,
	)
	fuzz |= Fuzz.EditDistanceMatch
	if (maxDistance > 0) {
		const ctxPass6 = ctxPass5.split('\n')
		for (let i = start; i < lines.length; i++) {
			let totalDistance = 0
			for (
				let j = 0;
				j < ctxPass6.length && totalDistance < maxDistance;
				j++
			) {
				totalDistance += computeLevenshteinDistance(
					workingLines[i + j],
					ctxPass6[j],
				)
			}
			if (totalDistance <= maxDistance) {
				return { line: i, fuzz }
			}
		}
	}

	return undefined
}

function findContext(
	path: string,
	lines: string[],
	context: string[],
	start: number,
	eof: boolean,
): FuzzMatch | undefined {
	// Skip filepath comments in provided context
	path = path.trim()
	if (lines[0]?.includes(path)) {
		lines = lines.slice(1)
	}
	if (context[0]?.includes(path)) {
		context = context.slice(1)
	}

	if (eof) {
		const match1 = findContextCore(
			lines,
			context,
			lines.length - context.length,
		)
		if (match1) {
			return match1
		}
		const match2 = findContextCore(lines, context, start)
		if (match2) {
			match2.fuzz |= Fuzz.IgnoredEofSignal
			return match2
		}
	}
	return findContextCore(lines, context, start)
}

// -----------------------------------------------------------------------------
// Section peeking
// -----------------------------------------------------------------------------

function peekNextSection(
	lines: string[],
	initialIndex: number,
	fuzzMerge = 0,
): {
	nextChunkContext: string[]
	chunks: Chunk[]
	endPatchIndex: number
	eof: boolean
	fuzzMerges: number
} {
	const enum Mode {
		Add,
		Delete,
		Keep,
	}
	let index = initialIndex
	const old: string[] = []
	let delLines: string[] = []
	let insLines: string[] = []
	const chunks: Chunk[] = []
	let mode: Mode = Mode.Keep
	let fuzzMergeNo = 0

	while (index < lines.length) {
		const s = lines[index]
		if (
			[
				CHUNK_DELIMITER,
				PATCH_SUFFIX,
				UPDATE_FILE_PREFIX,
				DELETE_FILE_PREFIX,
				ADD_FILE_PREFIX,
				END_OF_FILE_PREFIX,
			].some((p) => s.startsWith(p.trim()))
		) {
			if (
				mode === Mode.Keep &&
				old.length &&
				!/\S/.test(old[old.length - 1])
			) {
				old.pop()
			}
			break
		}
		if (s === '***') {
			break
		}
		if (s.startsWith('***')) {
			throw new InvalidPatchFormatError(
				`Invalid Line: ${s}`,
				'invalidLine',
			)
		}
		index += 1
		const lastMode: Mode = mode
		let line = s
		if (line[0] === HUNK_ADD_LINE_PREFIX) {
			mode = Mode.Add
		} else if (line[0] === HUNK_DELETE_LINE_PREFIX) {
			mode = Mode.Delete
		} else if (line[0] === ' ') {
			mode = Mode.Keep
		} else {
			// Tolerate invalid lines where the leading whitespace is missing.
			// Models sometimes don't fully adhere to the spec.
			const nextLine = lines[index]
			const nextOp =
				nextLine?.[0] === HUNK_ADD_LINE_PREFIX
					? Mode.Add
					: nextLine?.[0] === HUNK_DELETE_LINE_PREFIX
						? Mode.Delete
						: Mode.Keep
			const canFuzz = mode !== Mode.Keep && nextOp === mode

			mode = Mode.Keep
			line = ' ' + line

			if (canFuzz) {
				fuzzMergeNo++
				if (fuzzMerge === fuzzMergeNo) {
					mode = nextOp
				}
			}
		}

		line = line.slice(1)
		if (mode === Mode.Keep && lastMode !== mode) {
			if (insLines.length || delLines.length) {
				chunks.push({
					origIndex: old.length - delLines.length,
					delLines,
					insLines,
				})
			}
			delLines = []
			insLines = []
		}
		if (mode === Mode.Delete) {
			delLines.push(line)
			old.push(line)
		} else if (mode === Mode.Add) {
			insLines.push(line)
		} else {
			old.push(line)
		}
	}
	if (insLines.length || delLines.length) {
		chunks.push({
			origIndex: old.length - delLines.length,
			delLines,
			insLines,
		})
	}
	if (index < lines.length && lines[index] === END_OF_FILE_PREFIX) {
		index += 1
		return {
			nextChunkContext: old,
			chunks,
			endPatchIndex: index,
			eof: true,
			fuzzMerges: fuzzMergeNo,
		}
	}

	return {
		nextChunkContext: old,
		chunks,
		endPatchIndex: index,
		eof: false,
		fuzzMerges: fuzzMergeNo,
	}
}

// -----------------------------------------------------------------------------
// Parser
// -----------------------------------------------------------------------------

class Parser {
	indentStyles: Record<string, IGuessedIndentation> = {}
	lines: string[]
	index = 0
	patch: Patch = { actions: {} }
	fuzz = 0

	constructor(
		private readonly currentFiles: Record<string, string>,
		lines: string[],
	) {
		// Preprocess: strip erroneous -/+ prefix from @@ hunk header lines.
		// LLMs sometimes output "-@@ -1,5 +1,5 @@" instead of "@@ -1,5 +1,5 @@".
		this.lines = lines.map((line) =>
			line.startsWith('-@@') || line.startsWith('+@@')
				? line.slice(1)
				: line,
		)
		for (const [path, content] of Object.entries(currentFiles)) {
			this.indentStyles[path] = guessIndentation(
				content.split('\n'),
				4,
				false,
			)
		}
	}

	private isDone(prefixes?: string[]): boolean {
		if (this.index >= this.lines.length) {
			return true
		}
		if (
			prefixes &&
			prefixes.some((p) =>
				this.lines[this.index].startsWith(p.trim()),
			)
		) {
			return true
		}
		return false
	}

	private startswith(prefix: string | string[]): boolean {
		const prefixes = Array.isArray(prefix) ? prefix : [prefix]
		return prefixes.some((p) => this.lines[this.index].startsWith(p))
	}

	private readStr(prefix = '', returnEverything = false): string {
		if (this.index >= this.lines.length) {
			throw new DiffError(
				`Index: ${this.index} >= ${this.lines.length}`,
			)
		}
		if (this.lines[this.index].startsWith(prefix)) {
			const text = returnEverything
				? this.lines[this.index]
				: this.lines[this.index].slice(prefix.length)
			this.index += 1
			return text ?? ''
		}
		return ''
	}

	parse(): void {
		while (!this.isDone([PATCH_SUFFIX])) {
			let path = this.readStr(UPDATE_FILE_PREFIX)
			if (path) {
				if (this.patch.actions[path]) {
					throw new DiffError(
						`Update File Error: Duplicate Path: ${path}`,
					)
				}
				const moveTo = this.readStr(MOVE_FILE_TO_PREFIX)
				if (!(path in this.currentFiles)) {
					throw new DiffError(
						`Update File Error: Missing File: ${path}`,
					)
				}
				const indentStyle = this.indentStyles[path]
				const text = this.currentFiles[path]
				const filepathComment = getFilepathComment(path)
				const action = this.parseUpdateFile(
					path,
					filepathComment,
					text,
					indentStyle,
				)
				action.movePath = moveTo || undefined
				this.patch.actions[path] = action
				continue
			}
			path = this.readStr(DELETE_FILE_PREFIX)
			if (path) {
				if (this.patch.actions[path]) {
					throw new DiffError(
						`Delete File Error: Duplicate Path: ${path}`,
					)
				}
				if (!(path in this.currentFiles)) {
					throw new DiffError(
						`Delete File Error: Missing File: ${path}`,
					)
				}
				this.patch.actions[path] = {
					type: ActionType.DELETE,
					chunks: [],
				}
				continue
			}
			path = this.readStr(ADD_FILE_PREFIX)
			if (path) {
				if (this.patch.actions[path]) {
					throw new DiffError(
						`Add File Error: Duplicate Path: ${path}`,
					)
				}
				if (path in this.currentFiles) {
					throw new DiffError(
						`Add File Error: File already exists: ${path}`,
					)
				}
				this.patch.actions[path] = this.parseAddFile()
				continue
			}
			throw new DiffError(
				`Unknown Line: ${this.lines[this.index]}`,
			)
		}
		if (!this.startswith(PATCH_SUFFIX.trim())) {
			throw new InvalidPatchFormatError(
				'Missing End Patch',
				'missingEndPatch',
			)
		}
		this.index += 1
	}

	private parseUpdateFile(
		filePath: string,
		filepathComment: string,
		text: string,
		targetIndentStyle: IGuessedIndentation,
	): PatchAction {
		const action: PatchAction = {
			type: ActionType.UPDATE,
			chunks: [],
		}
		const fileLines = text.split('\n')
		const replaceExplicitTabsByDefault =
			!AVOID_EXPLICIT_TABS_REGEX.test(filepathComment.trimEnd())
		let index = 0

		while (
			!this.isDone([
				PATCH_SUFFIX,
				UPDATE_FILE_PREFIX,
				DELETE_FILE_PREFIX,
				ADD_FILE_PREFIX,
				END_OF_FILE_PREFIX,
			])
		) {
			const sectionStr = this.readStr(CHUNK_DELIMITER, true)
			const defStr = sectionStr.slice(CHUNK_DELIMITER.length).trim()
			if (!(sectionStr || index === 0)) {
				throw new DiffError(
					`Invalid line. Consider splitting each change into individual apply_patch tool calls:\n${this.lines[this.index]}`,
				)
			}
			if (defStr) {
				let found = false
				if (
					!fileLines
						.slice(0, index)
						.some((s) => canon(s) === canon(defStr))
				) {
					for (let i = index; i < fileLines.length; i++) {
						if (canon(fileLines[i]) === canon(defStr)) {
							index = i + 1
							found = true
							break
						}
					}
				}
				if (
					!found &&
					!fileLines
						.slice(0, index)
						.some(
							(s) => canon(s.trim()) === canon(defStr),
						)
				) {
					for (let i = index; i < fileLines.length; i++) {
						if (
							canon(fileLines[i].trim()) ===
							canon(defStr)
						) {
							index = i + 1
							this.fuzz += 1
							break
						}
					}
				}
			}

			let nextSection = peekNextSection(this.lines, this.index)

			let match: FuzzMatch | undefined
			for (
				let i = 0;
				i <= nextSection.fuzzMerges && !match;
				i++
			) {
				if (i > 0) {
					nextSection = peekNextSection(this.lines, this.index, i)
				}
				match = findContext(
					filepathComment,
					fileLines,
					nextSection.nextChunkContext,
					index,
					nextSection.eof,
				)
				if (!match) {
					match = findContext(
						filepathComment,
						fileLines,
						nextSection.nextChunkContext,
						0,
						nextSection.eof,
					)
				}

				if (i > 0 && match) {
					match.fuzz |= Fuzz.MergedOperatorSection
				}
			}

			if (!match) {
				const ctxLines = nextSection.nextChunkContext
				const preview = ctxLines.slice(0, 3).join('\n')
				const suffix = ctxLines.length > 3 ? '\n...' : ''
				if (nextSection.eof) {
					throw new InvalidContextError(
						`Invalid EOF context in '${filePath}' near line ${index + 1}:\n${preview}${suffix}`,
						text,
						filePath,
						'invalidContext-eof',
					)
				} else {
					const kindForTelemetry = ctxLines[0]?.match(/^\\t/)
						? 'invalidContext-maybeInvalidTab'
						: ctxLines[0]?.match(/^\\\t/)
							? 'invalidContext-maybeEscapedTab'
							: 'invalidContext'
					throw new InvalidContextError(
						`Invalid context in '${filePath}' near line ${index + 1}:\n${preview}${suffix}`,
						text,
						filePath,
						kindForTelemetry,
					)
				}
			}
			this.fuzz += match.fuzz
			const srcIndentStyle = guessIndentation(
				nextSection.chunks
					.flatMap((c) => c.insLines)
					.concat(nextSection.nextChunkContext),
				targetIndentStyle.tabSize,
				targetIndentStyle.insertSpaces,
			)

			const matchedLineIndent = computeIndentLevel2(
				fileLines[match.line],
				targetIndentStyle.tabSize,
			)
			const normalizedNextChunkContext =
				match.fuzz & Fuzz.NormalizedExplicitTab
					? replaceExplicitTabs(nextSection.nextChunkContext[0])
					: match.fuzz & Fuzz.NormalizedExplicitNL
						? replaceExplicitNl(nextSection.nextChunkContext[0])
						: nextSection.nextChunkContext[0]
			const srcLineIndent =
				nextSection.nextChunkContext &&
				nextSection.nextChunkContext.length > 0
					? computeIndentLevel2(
							normalizedNextChunkContext,
							srcIndentStyle.tabSize,
						)
					: 0
			const additionalIndentation = getIndentationChar(
				targetIndentStyle,
			).repeat(Math.max(0, matchedLineIndent - srcLineIndent))

			for (const ch of nextSection.chunks) {
				ch.origIndex += match.line
				if (match.fuzz & Fuzz.NormalizedExplicitNL) {
					ch.insLines = ch.insLines.map(replaceExplicitNl)
					ch.delLines = ch.delLines.map(replaceExplicitNl)
				}

				if (
					replaceExplicitTabsByDefault ||
					match.fuzz & Fuzz.NormalizedExplicitTab
				) {
					ch.insLines = ch.insLines.map(replaceExplicitTabs)
				}

				ch.insLines = ch.insLines.map((ins) =>
					isFalsyOrWhitespace(ins)
						? ins
						: additionalIndentation +
							transformIndentation(
								ins,
								srcIndentStyle,
								targetIndentStyle,
							),
				)

				if (match.fuzz & Fuzz.NormalizedExplicitTab) {
					ch.delLines = ch.delLines.map(replaceExplicitTabs)
				}

				action.chunks.push(ch)
			}
			index = match.line + nextSection.nextChunkContext.length
			this.index = nextSection.endPatchIndex
		}
		return action
	}

	private parseAddFile(): PatchAction {
		const lines: string[] = []
		while (
			!this.isDone([
				PATCH_SUFFIX,
				UPDATE_FILE_PREFIX,
				DELETE_FILE_PREFIX,
				ADD_FILE_PREFIX,
			])
		) {
			const s = this.readStr()
			if (!s.startsWith(HUNK_ADD_LINE_PREFIX)) {
				throw new InvalidPatchFormatError(
					`Invalid Add File Line: ${s}`,
					'invalidAddFileLine',
				)
			}
			lines.push(s.slice(1))
		}
		return {
			type: ActionType.ADD,
			newFile: lines.join('\n'),
			chunks: [],
		}
	}
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

/**
 * Parse an apply_patch formatted text into a Patch object.
 *
 * Each file path appears at most once in the resulting {@link Patch.actions}.
 * If the same file has multiple hunks, they are consolidated into the
 * `chunks` array of a single {@link PatchAction}. Duplicate file paths
 * in the patch text cause an error.
 *
 * @param text - The patch text in apply_patch format
 * @param currentFiles - Map of file paths to their current content strings
 * @returns A tuple of [Patch, fuzzScore] where fuzzScore indicates
 *          the cumulative fuzzy-matching distance (0 = exact matches only)
 * @throws {InvalidPatchFormatError} When the patch text is malformed
 * @throws {InvalidContextError} When context matching fails
 * @throws {DiffError} For other patch-related errors
 */
export function textToPatch(
	text: string,
	currentFiles: Record<string, string>,
): [Patch, number] {
	const lines = text.trim().split('\n')
	if (lines.length < 2) {
		throw new InvalidPatchFormatError(
			'Invalid patch text',
			'invalidPatchText',
		)
	}
	const patchPrefix = PATCH_PREFIX.trim()
	if (!(lines[0] ?? '').startsWith(patchPrefix)) {
		throw new InvalidPatchFormatError(
			`Invalid patch text. Patch must start with ${patchPrefix}.`,
			'invalidPatchTextPrefix',
		)
	}
	const patchSuffix = PATCH_SUFFIX.trim()
	if (lines[lines.length - 1] !== patchSuffix) {
		lines.push(patchSuffix)
	}
	const parser = new Parser(currentFiles, lines)
	parser.index = 1
	parser.parse()
	return [parser.patch, parser.fuzz]
}

/**
 * Re-export file identification utilities for convenience.
 */
export {
	identifyFilesAffected,
	identifyFilesNeeded,
	identifyFilesAdded,
	stripCodeBlockFences,
} from './utils.js'

// -----------------------------------------------------------------------------
// Patch application
// -----------------------------------------------------------------------------

/**
 * Apply an UPDATE action's chunks to the original file text
 * and return the resulting new content.
 */
function getUpdatedFile(
	text: string,
	action: PatchAction,
	path: string,
): string {
	if (action.type !== ActionType.UPDATE) {
		throw new DiffError('Expected UPDATE action')
	}
	const origLines = text.split('\n')
	const destLines: string[] = []
	let origIndex = 0
	for (const chunk of action.chunks) {
		if (chunk.origIndex > origLines.length) {
			throw new DiffError(
				`${path}: chunk.origIndex ${chunk.origIndex} > len(lines) ${origLines.length}`,
			)
		}
		if (origIndex > chunk.origIndex) {
			throw new DiffError(
				`${path}: origIndex ${origIndex} > chunk.origIndex ${chunk.origIndex}`,
			)
		}
		destLines.push(...origLines.slice(origIndex, chunk.origIndex))
		const delta = chunk.origIndex - origIndex
		origIndex += delta

		// inserted lines
		if (chunk.insLines.length) {
			for (const l of chunk.insLines) {
				destLines.push(l)
			}
		}
		origIndex += chunk.delLines.length
	}
	destLines.push(...origLines.slice(origIndex))
	return destLines.join('\n')
}

/**
 * Apply a parsed Patch to the original file contents and produce a Commit
 * describing all changes.
 *
 * Each file has at most one entry in the resulting Commit.
 * For UPDATE actions, all chunks are merged into the final newContent.
 *
 * @param patch - Parsed patch from {@link textToPatch}
 * @param currentFiles - Map of file paths to their current content strings
 * @returns A Commit with FileChange entries for each affected file
 */
export function patchToCommit(
	patch: Patch,
	currentFiles: Record<string, string>,
): Commit {
	const commit: Commit = { changes: {} }
	for (const [pathKey, action] of Object.entries(patch.actions)) {
		if (action.type === ActionType.DELETE) {
			commit.changes[pathKey] = {
				type: ActionType.DELETE,
				oldContent: currentFiles[pathKey],
			}
		} else if (action.type === ActionType.ADD) {
			commit.changes[pathKey] = {
				type: ActionType.ADD,
				newContent: action.newFile ?? '',
			}
		} else if (action.type === ActionType.UPDATE) {
			const text = currentFiles[pathKey]
			if (text === undefined) {
				throw new DiffError(
					`Update File Error: Missing File: ${pathKey}`,
				)
			}
			const newContent = getUpdatedFile(text, action, pathKey)
			commit.changes[pathKey] = {
				type: ActionType.UPDATE,
				oldContent: text,
				newContent,
				movePath: action.movePath,
			}
		}
	}
	return commit
}

/**
 * Apply a Commit to the filesystem using provided callbacks.
 *
 * @param commit - The commit to apply
 * @param writeFn - Callback to write content to a file path
 * @param removeFn - Callback to remove a file at a path
 */
export function applyCommit(
	commit: Commit,
	writeFn: (path: string, content: string) => void,
	removeFn: (path: string) => void,
): void {
	for (const [p, change] of Object.entries(commit.changes)) {
		if (change.type === ActionType.DELETE) {
			removeFn(p)
		} else if (change.type === ActionType.ADD) {
			writeFn(p, change.newContent ?? '')
		} else if (change.type === ActionType.UPDATE) {
			if (change.movePath) {
				writeFn(change.movePath, change.newContent ?? '')
				removeFn(p)
			} else {
				writeFn(p, change.newContent ?? '')
			}
		}
	}
}
