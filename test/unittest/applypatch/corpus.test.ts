import * as fs from 'fs'
import * as path from 'path'
import { suite, test } from 'mocha'
import * as assert from 'node:assert'
import { textToPatch, patchToCommit } from '../../../src/applypatch/parser.js'

// __dirname is out/test/unittest/applypatch; corpus files are in the source tree
const corpusDir = path.join(__dirname, '..', '..', '..', '..', 'test', 'unittest', 'applypatch', 'corpus')

/**
 * Parse escaped text from 262549-call.txt format:
 * literal \n and \t in the file become actual newlines and tabs.
 */
function parseEscapedText(raw: string): string {
	return JSON.parse('"' + raw.replaceAll('\n', '\\n').replaceAll('\t', '\\t') + '"') as string
}

suite('corpus', () => {
	test('applies all .patch corpus files', () => {
		const patchFiles = fs.readdirSync(corpusDir)
			.filter(f => f.endsWith('.patch'))
			.sort((a, b) => parseInt(a) - parseInt(b))

		for (const patchFile of patchFiles) {
			const patchContent = fs.readFileSync(path.join(corpusDir, patchFile), 'utf8')
			const { patch, original, expected, fpath } = JSON.parse(patchContent) as {
				patch: string
				original: string
				expected: string
				fpath: string
			}

			const currentFiles: Record<string, string> = {}
			currentFiles[fpath] = original

			try {
				const [parsed] = textToPatch(patch, currentFiles)
				const commit = patchToCommit(parsed, currentFiles)
				const change = commit.changes[fpath]
				assert.ok(change, `${patchFile}: no change produced for ${fpath}`)
				assert.strictEqual(change.newContent, expected, `${patchFile}: output mismatch for ${fpath}`)
			} catch (e) {
				assert.fail(`${patchFile}: ${(e as Error).message}\n${patch}`)
			}
		}
	})

	test('issue#262549: PowerShell script patch', () => {
		const input = fs.readFileSync(path.join(corpusDir, '262549-input.txt'), 'utf-8')
		const patchFmt = fs.readFileSync(path.join(corpusDir, '262549-call.txt'), 'utf-8')
		const patch = parseEscapedText(patchFmt)
		const expectedOutput = fs.readFileSync(path.join(corpusDir, '262549-output.txt'), 'utf-8')

		const filePath = '/Users/omitted/projects/flagship/edge-ai/scripts/Fix-VisuallySimilarUnicode.ps1'
		const currentFiles: Record<string, string> = {}
		currentFiles[filePath] = input

		const [parsed] = textToPatch(patch, currentFiles)
		const commit = patchToCommit(parsed, currentFiles)
		const actualOutput = commit.changes[filePath]?.newContent
		assert.ok(actualOutput, 'no output produced')
		assert.strictEqual(actualOutput, expectedOutput)
	})

	test('issue#267547: CRLF normalization', () => {
		const input = fs.readFileSync(path.join(corpusDir, '267547-input.txt'), 'utf-8')
		let patchFmt = fs.readFileSync(path.join(corpusDir, '267547-call.txt'), 'utf-8')
		patchFmt = patchFmt.replaceAll('\r\n', '\n')
		const expectedOutput = fs.readFileSync(path.join(corpusDir, '267547-output.txt'), 'utf-8')

		const currentFiles: Record<string, string> = {}
		currentFiles['267547.txt'] = input.replaceAll('\r\n', '\n')

		const [parsed] = textToPatch(patchFmt, currentFiles)
		const commit = patchToCommit(parsed, currentFiles)
		const actualOutput = commit.changes['267547.txt']?.newContent
		assert.ok(actualOutput, 'no output produced')
		assert.strictEqual(
			actualOutput?.replaceAll('\r\n', '\n'),
			expectedOutput.replaceAll('\r\n', '\n')
		)
	})

	test('multipleSections: indent across sections', () => {
		const input = fs.readFileSync(path.join(corpusDir, 'multipleSections-input.txt'), 'utf-8')
		let patchFmt = fs.readFileSync(path.join(corpusDir, 'multipleSections-call.txt'), 'utf-8')
		patchFmt = patchFmt.replaceAll('\r\n', '\n')
		const expectedOutput = fs.readFileSync(path.join(corpusDir, 'multipleSections-output.txt'), 'utf-8')

		const currentFiles: Record<string, string> = {}
		currentFiles['multipleSections.txt'] = input.replaceAll('\r\n', '\n')

		const [parsed] = textToPatch(patchFmt, currentFiles)
		const commit = patchToCommit(parsed, currentFiles)
		const actualOutput = commit.changes['multipleSections.txt']?.newContent
		assert.ok(actualOutput, 'no output produced')
		assert.strictEqual(
			actualOutput?.replaceAll('\r\n', '\n'),
			expectedOutput.replaceAll('\r\n', '\n')
		)
	})

	test('multipleIndentedLines: multi-line indentation update', () => {
		const input = fs.readFileSync(path.join(corpusDir, 'multipleIndentedLines-input.txt'), 'utf-8')
		let patchFmt = fs.readFileSync(path.join(corpusDir, 'multipleIndentedLines-call.txt'), 'utf-8')
		patchFmt = patchFmt.replaceAll('\r\n', '\n')
		const expectedOutput = fs.readFileSync(path.join(corpusDir, 'multipleIndentedLines-output.txt'), 'utf-8')

		const currentFiles: Record<string, string> = {}
		currentFiles['multipleIndentedLines.txt'] = input.replaceAll('\r\n', '\n')

		const [parsed] = textToPatch(patchFmt, currentFiles)
		const commit = patchToCommit(parsed, currentFiles)
		const actualOutput = commit.changes['multipleIndentedLines.txt']?.newContent
		assert.ok(actualOutput, 'no output produced')
		assert.strictEqual(
			actualOutput?.replaceAll('\r\n', '\n'),
			expectedOutput.replaceAll('\r\n', '\n')
		)
	})

	test('reindent: unindented code reindented', () => {
		const input = fs.readFileSync(path.join(corpusDir, 'reindent-input.txt'), 'utf-8')
		const patch = fs.readFileSync(path.join(corpusDir, 'reindent-call.txt'), 'utf-8')

		const filePath = '/Users/connor/Downloads/hello.yml'
		const currentFiles: Record<string, string> = {}
		currentFiles[filePath] = input

		const [parsed] = textToPatch(patch, currentFiles)
		const commit = patchToCommit(parsed, currentFiles)
		const actualOutput = commit.changes[filePath]?.newContent
		assert.ok(actualOutput, 'no output produced')

		const expected = [
			'- hello',
			'- world',
			'- list:',
			'    - item1',
			'    - item2',
			'    - item3',
			'    - item1a',
			'    - item2a',
			'    - item3a',
			'    - item1b',
			'    - item20b',
			'      - nested3',
			'      - nested2',
			'    - item3b',
			'    - item1c',
			'    - item2c',
			'    - item3c',
			'    - item1d',
			'    - item2d',
			'    - item3d',
			'',
		].join('\n')
		assert.strictEqual(actualOutput, expected)
	})
})
