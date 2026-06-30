/**
 * Types and constants for OpenAI apply_patch format parsing.
 *
 * Based on the reference implementation from VS Code / OpenAI Codex.
 * This is a standalone library with no VS Code dependencies.
 */

// -----------------------------------------------------------------------------
// Patch format constants
// -----------------------------------------------------------------------------

export const PATCH_PREFIX = '*** Begin Patch\n'
export const PATCH_SUFFIX = '\n*** End Patch'
export const ADD_FILE_PREFIX = '*** Add File: '
export const DELETE_FILE_PREFIX = '*** Delete File: '
export const UPDATE_FILE_PREFIX = '*** Update File: '
export const MOVE_FILE_TO_PREFIX = '*** Move to: '
export const END_OF_FILE_PREFIX = '*** End of File'
export const HUNK_ADD_LINE_PREFIX = '+'
export const HUNK_DELETE_LINE_PREFIX = '-'

// -----------------------------------------------------------------------------
// Action types
// -----------------------------------------------------------------------------

export enum ActionType {
	ADD = 'add',
	DELETE = 'delete',
	UPDATE = 'update',
}

// -----------------------------------------------------------------------------
// Patch structures
// -----------------------------------------------------------------------------

export interface Chunk {
	/** Line index of the first line in the original file */
	origIndex: number
	delLines: string[]
	insLines: string[]
}

export interface PatchAction {
	type: ActionType
	newFile?: string | undefined
	chunks: Chunk[]
	movePath?: string | undefined
}

export interface Patch {
	actions: Record<string, PatchAction>
}

// -----------------------------------------------------------------------------
// Commit structures (result of applying a patch)
// -----------------------------------------------------------------------------

export interface FileChange {
	/** Type of change: add, delete, or update */
	type: ActionType
	/** Full content of the file before applying the patch. Present for delete and update operations; absent for add. */
	oldContent?: string | undefined
	/** Full content of the file after applying the patch. Present for add and update operations; absent for delete. */
	newContent?: string | undefined
	/** Destination path when the file is being moved, relative to the workspace root */
	movePath?: string | undefined
}

export interface Commit {
	changes: Record<string, FileChange>
}

// -----------------------------------------------------------------------------
// Fuzz flags
// -----------------------------------------------------------------------------

/**
 * Flags indicating which fuzzy-matching steps were used during context matching.
 */
export const enum Fuzz {
	None = 0,
	/** Trailing whitespace was removed in context patch */
	IgnoredTrailingWhitespace = 1 << 1,
	/** Explicit \\t characters were fixed in the context patch */
	NormalizedExplicitTab = 1 << 2,
	/** Leading and trailing whitespace was removed in the context patch */
	IgnoredWhitespace = 1 << 3,
	/** Edit-distance-based fuzzy matching was used in the context patch */
	EditDistanceMatch = 1 << 4,
	/** The patch said it came at the end of the file, but it did not and matched elsewhere */
	IgnoredEofSignal = 1 << 5,
	/** Surrounding operations were removed in patch context */
	MergedOperatorSection = 1 << 6,
	/** Explicit \\n characters were fixed in the context patch */
	NormalizedExplicitNL = 1 << 7,
}

export interface FuzzMatch {
	line: number
	fuzz: Fuzz
}

// -----------------------------------------------------------------------------
// Indentation types
// -----------------------------------------------------------------------------

export interface IGuessedIndentation {
	/** If indentation is based on spaces, the number of spaces that make an indent */
	tabSize: number
	/** Is indentation based on spaces? */
	insertSpaces: boolean
}

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

export class DiffError extends Error {}

export class InvalidContextError extends DiffError {
	constructor(
		message: string,
		public readonly file: string,
		public readonly kindForTelemetry: string,
	) {
		super(message)
	}
}

export class InvalidPatchFormatError extends DiffError {
	constructor(
		message: string,
		public readonly kindForTelemetry: string,
	) {
		super(message)
	}
}
