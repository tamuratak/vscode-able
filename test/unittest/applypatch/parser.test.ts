import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { textToPatch, replaceExplicitTabs, replaceExplicitNl, patchToCommit, applyCommit } from '../../../src/applypatch/parser.js'
import { identifyFilesAffected, identifyFilesNeeded, identifyFilesAdded, stripCodeBlockFences } from '../../../src/applypatch/utils.js'
import { DiffError, InvalidPatchFormatError, InvalidContextError, ActionType } from '../../../src/applypatch/types.js'

suite('textToPatch', () => {
	test('parses a simple update patch', () => {
		const patchText = [
			'*** Begin Patch',
			'*** Update File: src/main.ts',
			'@@',
			' function hello() {',
			'-  console.log("old")',
			'+  console.log("new")',
			' }',
			'*** End Patch',
		].join('\n')

		const currentFiles = {
			'src/main.ts': 'function hello() {\n  console.log("old")\n}\n',
		}
		const [patch, _fuzz] = textToPatch(patchText, currentFiles)

		const action = patch.actions['src/main.ts']
		assert.ok(action)
		assert.strictEqual(action.type, ActionType.UPDATE)
		assert.strictEqual(action.chunks.length, 1)

		const chunk = action.chunks[0]
		assert.ok(chunk)
		assert.strictEqual(chunk.delLines.length, 1)
		assert.strictEqual(chunk.insLines.length, 1)
		assert.strictEqual(chunk.delLines[0], '  console.log("old")')
		assert.strictEqual(chunk.insLines[0], '  console.log("new")')
	})

	test('parses an add file patch', () => {
		const patchText = [
			'*** Begin Patch',
			'*** Add File: src/new.ts',
			'+export function foo() {',
			'+  return 42',
			'+}',
			'*** End Patch',
		].join('\n')

		const currentFiles = {}
		const [patch, _fuzz] = textToPatch(patchText, currentFiles)

		const action = patch.actions['src/new.ts']
		assert.ok(action)
		assert.strictEqual(action.type, ActionType.ADD)
		assert.strictEqual(action.newFile, 'export function foo() {\n  return 42\n}')
	})

	test('parses a delete file patch', () => {
		const patchText = [
			'*** Begin Patch',
			'*** Delete File: src/old.ts',
			'*** End Patch',
		].join('\n')

		const currentFiles = { 'src/old.ts': 'content' }
		const [patch, _fuzz] = textToPatch(patchText, currentFiles)

		const action = patch.actions['src/old.ts']
		assert.ok(action)
		assert.strictEqual(action.type, ActionType.DELETE)
	})

	test('parses a multi-file patch', () => {
		const patchText = [
			'*** Begin Patch',
			'*** Update File: a.ts',
			'@@',
			' line1',
			'-old',
			'+new',
			'*** Update File: b.ts',
			'@@',
			' x',
			'-y',
			'+z',
			'*** End Patch',
		].join('\n')

		const currentFiles = {
			'a.ts': 'line1\nold\n',
			'b.ts': 'x\ny\n',
		}
		const [patch, _fuzz] = textToPatch(patchText, currentFiles)

		assert.ok(patch.actions['a.ts'])
		assert.ok(patch.actions['b.ts'])
	})

	test('returns fuzz score of 0 for exact matches', () => {
		const patchText = [
			'*** Begin Patch',
			'*** Update File: f.ts',
			'@@',
			' exact line',
			'-old exact',
			'+new exact',
			'*** End Patch',
		].join('\n')

		const currentFiles = { 'f.ts': 'exact line\nold exact\n' }
		const [_patch, fuzz] = textToPatch(patchText, currentFiles)

		assert.strictEqual(fuzz, 0)
	})

	test('handles move-to directive', () => {
		const patchText = [
			'*** Begin Patch',
			'*** Update File: src/old.ts',
			'*** Move to: src/new.ts',
			'@@',
			' content',
			'-old',
			'+new',
			'*** End Patch',
		].join('\n')

		const currentFiles = { 'src/old.ts': 'content\nold\n' }
		const [patch, _fuzz] = textToPatch(patchText, currentFiles)

		const action = patch.actions['src/old.ts']
		assert.ok(action)
		assert.strictEqual(action.movePath, 'src/new.ts')
	})

	test('applies update to produce correct new content', () => {
		const patchText = [
			'*** Begin Patch',
			'*** Update File: f.ts',
			'@@',
			' function greet() {',
			'-  return "hello"',
			'+  return "world"',
			' }',
			'*** End Patch',
		].join('\n')

		const original = 'function greet() {\n  return "hello"\n}\n'
		const currentFiles = { 'f.ts': original }
		const [patch, _fuzz] = textToPatch(patchText, currentFiles)

		const action = patch.actions['f.ts']
		assert.ok(action)
		assert.ok(action.chunks.length > 0)

		const chunk = action.chunks[0]
		assert.ok(chunk)
		assert.strictEqual(chunk.delLines[0], '  return "hello"')
		assert.strictEqual(chunk.insLines[0], '  return "world"')
	})
})

suite('fuzzy matching', () => {
	test('matches with Unicode punctuation differences (exact fuzz = 0)', () => {
		const patchText = [
			'*** Begin Patch',
			'*** Update File: f.ts',
			'@@',
			' a - b',
			'-old',
			'+new',
			'*** End Patch',
		].join('\n')

		const currentFiles = { 'f.ts': 'a \u2013 b\nold\n' }
		const [patch, fuzz] = textToPatch(patchText, currentFiles)

		assert.ok(patch.actions['f.ts'])
		assert.strictEqual(fuzz, 0, 'Unicode punctuation normalization should match with fuzz 0')
	})

	test('matches with ignored whitespace differences', () => {
		const patchText = [
			'*** Begin Patch',
			'*** Update File: f.ts',
			'@@',
			'  indented line',
			'-old',
			'+new',
			'*** End Patch',
		].join('\n')

		const currentFiles = { 'f.ts': '   indented line\nold\n' }
		const [patch, fuzz] = textToPatch(patchText, currentFiles)

		assert.ok(patch.actions['f.ts'])
		assert.ok(fuzz > 0, `Expected fuzz > 0 for whitespace differences, got ${fuzz}`)
	})

	test('matches with edit distance differences', () => {
		// Need multi-line context for edit distance to kick in
		// threshold = floor(contextLength * 0.34), so 3 lines => maxDistance = 1
		const patchText = [
			'*** Begin Patch',
			'*** Update File: f.ts',
			'@@',
			' line one',
			' indnted line',
			' line three',
			'-old',
			'+new',
			'*** End Patch',
		].join('\n')

		const currentFiles = { 'f.ts': 'line one\nindented line\nline three\nold\n' }
		const [patch, fuzz] = textToPatch(patchText, currentFiles)

		assert.ok(patch.actions['f.ts'])
		assert.ok(fuzz > 0, `Expected fuzz > 0 for edit distance, got ${fuzz}`)
	})

	test('matches from beginning of file when context not found from current position', () => {
		const patchText = [
			'*** Begin Patch',
			'*** Update File: f.ts',
			'@@',
			' second',
			'-b',
			'+B',
			'@@',
			' first',
			'-a',
			'+A',
			'*** End Patch',
		].join('\n')

		const currentFiles = { 'f.ts': 'first\na\nsecond\nb\n' }
		const [patch, _fuzz] = textToPatch(patchText, currentFiles)

		const action = patch.actions['f.ts']
		assert.ok(action)
		assert.strictEqual(action.chunks.length, 2)
	})
})

suite('error handling', () => {
	test('throws InvalidPatchFormatError for missing prefix', () => {
		assert.throws(
			() => textToPatch('not a patch', {}),
			InvalidPatchFormatError,
		)
	})

	test('throws DiffError for missing file on update', () => {
		const patchText = [
			'*** Begin Patch',
			'*** Update File: nonexistent.ts',
			'@@',
			' x',
			'-a',
			'+b',
			'*** End Patch',
		].join('\n')

		assert.throws(
			() => textToPatch(patchText, {}),
			DiffError,
		)
	})

	test('throws DiffError for duplicate path', () => {
		const patchText = [
			'*** Begin Patch',
			'*** Update File: f.ts',
			'@@',
			' x',
			'-a',
			'+b',
			'*** Update File: f.ts',
			'@@',
			' x',
			'-a',
			'+b',
			'*** End Patch',
		].join('\n')

		assert.throws(
			() => textToPatch(patchText, { 'f.ts': 'x\na\n' }),
			DiffError,
		)
	})

	test('throws DiffError when adding existing file', () => {
		const patchText = [
			'*** Begin Patch',
			'*** Add File: f.ts',
			'+content',
			'*** End Patch',
		].join('\n')

		assert.throws(
			() => textToPatch(patchText, { 'f.ts': 'existing' }),
			DiffError,
		)
	})

	test('throws InvalidContextError when context does not match', () => {
		const patchText = [
			'*** Begin Patch',
			'*** Update File: f.ts',
			'@@',
			' totally different context that does not exist',
			'-old',
			'+new',
			'*** End Patch',
		].join('\n')

		assert.throws(
			() => textToPatch(patchText, { 'f.ts': 'completely unrelated\nold\n' }),
			InvalidContextError,
		)
	})
})

suite('explicit tab normalization', () => {
	test('replaceExplicitTabs converts \\t to real tabs', () => {
		assert.strictEqual(replaceExplicitTabs('\\thello'), '\thello')
	})

	test('replaceExplicitNl converts \\n to real newlines', () => {
		assert.strictEqual(replaceExplicitNl('a\\nb'), 'a\nb')
	})
})

suite('identifyFilesAffected', () => {
	test('returns all file paths from patch', () => {
		const text = [
			'*** Begin Patch',
			'*** Update File: a.ts',
			'*** Delete File: b.ts',
			'*** Add File: c.ts',
			'*** Update File: d.ts',
			'*** Move to: e.ts',
			'*** End Patch',
		].join('\n')

		const result = identifyFilesAffected(text)
		assert.ok(result.includes('a.ts'))
		assert.ok(result.includes('b.ts'))
		assert.ok(result.includes('c.ts'))
		assert.ok(result.includes('d.ts'))
		assert.ok(result.includes('e.ts'))
	})
})

suite('identifyFilesNeeded', () => {
	test('returns only files that must exist (update and delete)', () => {
		const text = [
			'*** Begin Patch',
			'*** Update File: a.ts',
			'*** Delete File: b.ts',
			'*** Add File: c.ts',
			'*** End Patch',
		].join('\n')

		const result = identifyFilesNeeded(text)
		assert.ok(result.includes('a.ts'))
		assert.ok(result.includes('b.ts'))
		assert.ok(!result.includes('c.ts'))
	})
})

suite('identifyFilesAdded', () => {
	test('returns only newly added files', () => {
		const text = [
			'*** Begin Patch',
			'*** Update File: a.ts',
			'*** Add File: b.ts',
			'*** Add File: c.ts',
			'*** End Patch',
		].join('\n')

		const result = identifyFilesAdded(text)
		assert.ok(!result.includes('a.ts'))
		assert.ok(result.includes('b.ts'))
		assert.ok(result.includes('c.ts'))
	})
})

suite('patchToCommit', () => {
	test('produces correct commit for update action', () => {
		const patchText = [
			'*** Begin Patch',
			'*** Update File: f.ts',
			'@@',
			' function greet() {',
			'-  return "hello"',
			'+  return "world"',
			' }',
			'*** End Patch',
		].join('\n')

		const currentFiles = { 'f.ts': 'function greet() {\n  return "hello"\n}\n' }
		const [patch, _fuzz] = textToPatch(patchText, currentFiles)
		const commit = patchToCommit(patch, currentFiles)

		const change = commit.changes['f.ts']
		assert.ok(change)
		assert.strictEqual(change.type, ActionType.UPDATE)
		assert.strictEqual(change.oldContent, 'function greet() {\n  return "hello"\n}\n')
		assert.strictEqual(change.newContent, 'function greet() {\n  return "world"\n}\n')
	})

	test('produces correct commit for add action', () => {
		const patchText = [
			'*** Begin Patch',
			'*** Add File: src/new.ts',
			'+export const x = 1',
			'*** End Patch',
		].join('\n')

		const currentFiles = {}
		const [patch, _fuzz] = textToPatch(patchText, currentFiles)
		const commit = patchToCommit(patch, currentFiles)

		const change = commit.changes['src/new.ts']
		assert.ok(change)
		assert.strictEqual(change.type, ActionType.ADD)
		assert.strictEqual(change.newContent, 'export const x = 1')
	})

	test('produces correct commit for delete action', () => {
		const patchText = [
			'*** Begin Patch',
			'*** Delete File: old.ts',
			'*** End Patch',
		].join('\n')

		const currentFiles = { 'old.ts': 'some content' }
		const [patch, _fuzz] = textToPatch(patchText, currentFiles)
		const commit = patchToCommit(patch, currentFiles)

		const change = commit.changes['old.ts']
		assert.ok(change)
		assert.strictEqual(change.type, ActionType.DELETE)
		assert.strictEqual(change.oldContent, 'some content')
	})

	test('includes movePath in commit for move operations', () => {
		const patchText = [
			'*** Begin Patch',
			'*** Update File: src/old.ts',
			'*** Move to: src/new.ts',
			'@@',
			' content',
			'-old',
			'+new',
			'*** End Patch',
		].join('\n')

		const currentFiles = { 'src/old.ts': 'content\nold\n' }
		const [patch, _fuzz] = textToPatch(patchText, currentFiles)
		const commit = patchToCommit(patch, currentFiles)

		const change = commit.changes['src/old.ts']
		assert.ok(change)
		assert.strictEqual(change.type, ActionType.UPDATE)
		assert.strictEqual(change.movePath, 'src/new.ts')
	})

	test('applies multiple chunks correctly', () => {
		const patchText = [
			'*** Begin Patch',
			'*** Update File: f.ts',
			'@@',
			' first',
			'-a',
			'+A',
			'@@',
			' second',
			'-c',
			'+C',
			'*** End Patch',
		].join('\n')

		const currentFiles = { 'f.ts': 'first\na\nsecond\nc\nthird' }
		const [patch, _fuzz] = textToPatch(patchText, currentFiles)
		const commit = patchToCommit(patch, currentFiles)

		const change = commit.changes['f.ts']
		assert.ok(change)
		assert.strictEqual(change.newContent, 'first\nA\nsecond\nC\nthird')
	})
})

suite('applyCommit', () => {
	test('writes updated files via writeFn', () => {
		const written: Record<string, string> = {}
		const removed: string[] = []

		const commit = {
			changes: {
				'f.ts': { type: ActionType.UPDATE as const, oldContent: 'old', newContent: 'new' },
			},
		}

		applyCommit(commit, (p, c) => { written[p] = c }, (p) => { removed.push(p) })

		assert.strictEqual(written['f.ts'], 'new')
		assert.strictEqual(removed.length, 0)
	})

	test('removes deleted files via removeFn', () => {
		const written: Record<string, string> = {}
		const removed: string[] = []

		const commit = {
			changes: {
				'old.ts': { type: ActionType.DELETE as const, oldContent: 'content' },
			},
		}

		applyCommit(commit, (p, c) => { written[p] = c }, (p) => { removed.push(p) })

		assert.strictEqual(Object.keys(written).length, 0)
		assert.deepStrictEqual(removed, ['old.ts'])
	})

	test('writes new files via writeFn', () => {
		const written: Record<string, string> = {}

		const commit = {
			changes: {
				'new.ts': { type: ActionType.ADD as const, newContent: 'hello' },
			},
		}

		applyCommit(commit, (p, c) => { written[p] = c }, () => { /* no-op */ })

		assert.strictEqual(written['new.ts'], 'hello')
	})

	test('handles movePath by writing to new path and removing old', () => {
		const written: Record<string, string> = {}
		const removed: string[] = []

		const commit = {
			changes: {
				'old.ts': { type: ActionType.UPDATE as const, oldContent: 'old', newContent: 'new', movePath: 'new.ts' },
			},
		}

		applyCommit(commit, (p, c) => { written[p] = c }, (p) => { removed.push(p) })

		assert.strictEqual(written['new.ts'], 'new')
		assert.ok(!('old.ts' in written))
		assert.deepStrictEqual(removed, ['old.ts'])
	})

	test('end-to-end: textToPatch then patchToCommit then applyCommit', () => {
		const patchText = [
			'*** Begin Patch',
			'*** Update File: a.ts',
			'@@',
			' function add(a, b) {',
			'-  return a + b',
			'+  return a - b',
			' }',
			'*** Add File: b.ts',
			'+export const b = 2',
			'*** End Patch',
		].join('\n')

		const currentFiles = { 'a.ts': 'function add(a, b) {\n  return a + b\n}\n' }
		const [patch, _fuzz] = textToPatch(patchText, currentFiles)
		const commit = patchToCommit(patch, currentFiles)

		const written: Record<string, string> = {}
		applyCommit(commit, (p, c) => { written[p] = c }, () => { /* no-op */ })

		assert.strictEqual(written['a.ts'], 'function add(a, b) {\n  return a - b\n}\n')
		assert.strictEqual(written['b.ts'], 'export const b = 2')
	})

	test('end-to-end: DELETE file through full pipeline', () => {
		const patchText = [
			'*** Begin Patch',
			'*** Delete File: obsolete.ts',
			'*** End Patch',
		].join('\n')

		const currentFiles = { 'obsolete.ts': 'old content here' }
		const [patch, _fuzz] = textToPatch(patchText, currentFiles)
		const commit = patchToCommit(patch, currentFiles)

		const written: Record<string, string> = {}
		const removed: string[] = []
		applyCommit(commit, (p, c) => { written[p] = c }, (p) => { removed.push(p) })

		assert.strictEqual(Object.keys(written).length, 0)
		assert.deepStrictEqual(removed, ['obsolete.ts'])
	})

	test('end-to-end: UPDATE with movePath through full pipeline', () => {
		const patchText = [
			'*** Begin Patch',
			'*** Update File: src/old.ts',
			'*** Move to: src/new.ts',
			'@@',
			' export const value =',
			'-  1',
			'+  42',
			'*** End Patch',
		].join('\n')

		const currentFiles = { 'src/old.ts': 'export const value =\n  1\n' }
		const [patch, _fuzz] = textToPatch(patchText, currentFiles)
		const commit = patchToCommit(patch, currentFiles)

		const written: Record<string, string> = {}
		const removed: string[] = []
		applyCommit(commit, (p, c) => { written[p] = c }, (p) => { removed.push(p) })

		assert.strictEqual(written['src/new.ts'], 'export const value =\n  42\n')
		assert.ok(!('src/old.ts' in written))
		assert.deepStrictEqual(removed, ['src/old.ts'])
	})
})

suite('stripCodeBlockFences', () => {
	test('strips triple backtick fences with language tag', () => {
		const input = '```diff\n*** Begin Patch\n*** End Patch\n```'
		assert.strictEqual(stripCodeBlockFences(input), '*** Begin Patch\n*** End Patch')
	})

	test('strips triple backtick fences without language tag', () => {
		const input = '```\n*** Begin Patch\n*** End Patch\n```'
		assert.strictEqual(stripCodeBlockFences(input), '*** Begin Patch\n*** End Patch')
	})

	test('strips tilde fences with language tag', () => {
		const input = '~~~diff\n*** Begin Patch\n*** End Patch\n~~~'
		assert.strictEqual(stripCodeBlockFences(input), '*** Begin Patch\n*** End Patch')
	})

	test('strips tilde fences without language tag', () => {
		const input = '~~~\n*** Begin Patch\n*** End Patch\n~~~'
		assert.strictEqual(stripCodeBlockFences(input), '*** Begin Patch\n*** End Patch')
	})

	test('strips opening fence only (no closing fence)', () => {
		const input = '```diff\n*** Begin Patch\n*** Update File: f.ts\n*** End Patch'
		assert.strictEqual(stripCodeBlockFences(input), '*** Begin Patch\n*** Update File: f.ts\n*** End Patch')
	})

	test('strips opening tilde fence only (no closing fence)', () => {
		const input = '~~~diff\n*** Begin Patch\n*** End Patch'
		assert.strictEqual(stripCodeBlockFences(input), '*** Begin Patch\n*** End Patch')
	})

	test('strips adjacent empty lines after opening fence', () => {
		const input = '```diff\n\n*** Begin Patch\n*** End Patch\n```'
		assert.strictEqual(stripCodeBlockFences(input), '*** Begin Patch\n*** End Patch')
	})

	test('strips adjacent empty lines before closing fence', () => {
		const input = '```diff\n*** Begin Patch\n*** End Patch\n\n```'
		assert.strictEqual(stripCodeBlockFences(input), '*** Begin Patch\n*** End Patch')
	})

	test('strips opening fence only with adjacent empty line', () => {
		const input = '```diff\n\n*** Begin Patch\n*** End Patch'
		assert.strictEqual(stripCodeBlockFences(input), '*** Begin Patch\n*** End Patch')
	})

	test('returns text as-is when no fences present', () => {
		const input = '*** Begin Patch\n*** End Patch'
		assert.strictEqual(stripCodeBlockFences(input), '*** Begin Patch\n*** End Patch')
	})

	test('throws when content is empty after stripping', () => {
		assert.throws(() => stripCodeBlockFences('```\n```'), Error)
	})

	test('throws when content is only whitespace after stripping', () => {
		assert.throws(() => stripCodeBlockFences('```\n  \n```'), Error)
	})

	test('handles longer fence markers (4+ backticks)', () => {
		const input = '````diff\n*** Begin Patch\n*** End Patch\n````'
		assert.strictEqual(stripCodeBlockFences(input), '*** Begin Patch\n*** End Patch')
	})
})

suite('InvalidContextError diagnostics', () => {
	test('contains contextLines and lineIndex when context does not match', () => {
		const patchText = [
			'*** Begin Patch',
			'*** Update File: f.ts',
			'@@',
			' totally different context that does not exist',
			'-old',
			'+new',
			'*** End Patch',
		].join('\n')

		assert.throws(
			() => textToPatch(patchText, { 'f.ts': 'completely unrelated\nold\n' }),
			(error: unknown) => {
				assert.ok(error instanceof InvalidContextError)
				assert.ok(Array.isArray(error.contextLines))
				assert.strictEqual(error.contextLines[0], 'totally different context that does not exist')
				assert.strictEqual(typeof error.lineIndex, 'number')
				return true
			},
		)
	})
})

suite('logger injection', () => {
	test('calls logger.debug on successful context match', () => {
		const messages: string[] = []
		const logger = { debug: (msg: string) => { messages.push(msg) } }

		const patchText = [
			'*** Begin Patch',
			'*** Update File: f.ts',
			'@@',
			' function hello() {',
			'-  console.log("old")',
			'+  console.log("new")',
			' }',
			'*** End Patch',
		].join('\n')

		textToPatch(patchText, { 'f.ts': 'function hello() {\n  console.log("old")\n}\n' }, logger)

		assert.ok(messages.length > 0)
		assert.ok(messages[0].includes('[apply_patch] MATCH:'))
		assert.ok(messages[0].includes('f.ts'))
	})
})
