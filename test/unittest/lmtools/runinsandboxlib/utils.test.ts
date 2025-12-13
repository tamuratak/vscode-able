import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { wrapLongLines } from '../../../../src/lmtools/runinsandbox.js'

suite('runinsandbox utils', () => {
	test('wrapLongLines leaves short lines intact', () => {
		const input = 'short line'
		assert.strictEqual(wrapLongLines(input), input)
	})

	test('wrapLongLines wraps long single line', () => {
		const long = 'a'.repeat(95)
		const out = wrapLongLines(long)
		const expected = 'a'.repeat(90) + '\\' + '\n' + 'a'.repeat(5)
		assert.strictEqual(out, expected)
	})

	test('wrapLongLines wraps only long lines in multi-line input', () => {
		const short = 'short'
		const long = 'b'.repeat(185) // 90 + 90 + 5
		const input = short + '\n' + long
		const out = wrapLongLines(input)
		const expectedLong = 'b'.repeat(90) + '\\' + '\n' + 'b'.repeat(90) + '\\' + '\n' + 'b'.repeat(5)
		assert.strictEqual(out, short + '\n' + expectedLong)
	})
})

