import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { textToPatch, replaceExplicitTabs, replaceExplicitNl } from '../../../src/applypatch/parser.js'
import { identifyFilesAffected, identifyFilesNeeded, identifyFilesAdded } from '../../../src/applypatch/utils.js'
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
