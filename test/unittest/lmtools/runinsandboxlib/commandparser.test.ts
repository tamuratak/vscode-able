import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { hasWriteRedirection } from '../../../../src/lmtools/runinsandboxlib/commandparser.js'

suite('tree-sitter command parser', () => {
	test('detects truncate redirection', async () => {
		const result = await hasWriteRedirection('echo hi > output.txt')
		assert.strictEqual(result, true)
	})

	test('detects append redirection', async () => {
		const result = await hasWriteRedirection('printf hello >> logs.txt')
		assert.strictEqual(result, true)
	})

	test('detects descriptor-prefixed redirection', async () => {
		const result = await hasWriteRedirection('echo hi 2> errors.txt')
		assert.strictEqual(result, true)
	})

	test('ignores input redirection', async () => {
		const result = await hasWriteRedirection('cat < input.txt')
		assert.strictEqual(result, false)
	})

	test('returns false when no redirection operators are present', async () => {
		const result = await hasWriteRedirection('echo hello world')
		assert.strictEqual(result, false)
	})
})
