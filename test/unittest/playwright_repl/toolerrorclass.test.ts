import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { classifyExecutionError } from '../../../src/playwright_repl/errorclassify.js'

suite('playwright repl tool error classification', () => {
    test('classifies kernel channel failures as infrastructure', () => {
        const value = classifyExecutionError('playwright repl kernel exited unexpectedly')
        assert.strictEqual(value, 'infrastructure')
    })

    test('classifies timeout as runtime guard', () => {
        const value = classifyExecutionError('playwright repl timed out after 15000ms')
        assert.strictEqual(value, 'runtime_guard')
    })

    test('classifies policy violations as runtime guard', () => {
        const value = classifyExecutionError('import is disabled in playwright repl')
        assert.strictEqual(value, 'runtime_guard')
    })

    test('classifies remaining errors as playwright runtime', () => {
        const value = classifyExecutionError('locator.click: Timeout 30000ms exceeded')
        assert.strictEqual(value, 'playwright_runtime')
    })
})
