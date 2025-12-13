import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { hasNoWriteRedirection, normalizeToken } from '../../../../src/lmtools/runinsandboxlib/commandparser.js'

suite('tree-sitter command parser', () => {
	test('detects truncate redirection', async () => {
		const result = await hasNoWriteRedirection('echo hi > output.txt')
		assert.strictEqual(result, false)
	})

	test('detects append redirection', async () => {
		const result = await hasNoWriteRedirection('printf hello >> logs.txt')
		assert.strictEqual(result, false)
	})

	test('detects descriptor-prefixed redirection', async () => {
		const result = await hasNoWriteRedirection('echo hi 2> errors.txt')
		assert.strictEqual(result, false)
	})

	test('ignores input redirection', async () => {
		const result = await hasNoWriteRedirection('cat < input.txt')
		assert.strictEqual(result, true)
	})

	test('returns false when no redirection operators are present', async () => {
		const result = await hasNoWriteRedirection('echo hello world')
		assert.strictEqual(result, true)
	})
})

suite('normalizeToken', () => {
	test('returns same for unquoted token', () => {
		const result = normalizeToken('hello')
		assert.strictEqual(result, 'hello')
	})

	test('strips double quotes', () => {
		const result = normalizeToken('"hello"')
		assert.strictEqual(result, 'hello')
	})

	test('strips single quotes', () => {
		const result = normalizeToken("'hello'")
		assert.strictEqual(result, 'hello')
	})

	test('unescapes escaped double quote inside double quotes', () => {
		const result = normalizeToken('"he\\"llo"')
		assert.strictEqual(result, 'he"llo')
	})

	test('unescapes escaped single quote', () => {
		const result = normalizeToken('it\\\'s')
		assert.strictEqual(result, 'it\'s')
	})

	test('unescapes escaped space', () => {
		const result = normalizeToken('a\\ b')
		assert.strictEqual(result, 'a b')
	})

	test('removes backslash-newline sequences', () => {
		const result = normalizeToken('first\\\nsecond')
		assert.strictEqual(result, 'firstsecond')
	})

	test('unescapes double backslash to single backslash', () => {
		const result = normalizeToken('\\\\')
		assert.strictEqual(result, '\\')
	})
})
