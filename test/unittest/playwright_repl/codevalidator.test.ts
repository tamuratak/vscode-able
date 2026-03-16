import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { validatePlaywrightReplCode } from '../../../src/playwright_repl/codevalidator.js'

suite('playwright code validator', () => {
    test('accepts simple async code', async () => {
        const result = await validatePlaywrightReplCode('await Promise.resolve(1)')
        assert.strictEqual(result.ok, true)
    })

    test('rejects require call', async () => {
        const result = await validatePlaywrightReplCode('const fs = require("fs")')
        assert.strictEqual(result.ok, false)
    })

    test('rejects import statement', async () => {
        const result = await validatePlaywrightReplCode('import x from "node:fs"')
        assert.strictEqual(result.ok, false)
    })

    test('rejects empty code', async () => {
        const result = await validatePlaywrightReplCode('   ')
        assert.strictEqual(result.ok, false)
    })
})
