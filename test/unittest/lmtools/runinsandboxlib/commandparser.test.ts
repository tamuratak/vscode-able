import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { hasNoWriteRedirection } from '../../../../src/lmtools/runinsandboxlib/commandparser.js'

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
