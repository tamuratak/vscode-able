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
        assert.ok(result.reason?.includes('require'))
    })

    test('rejects import statement', async () => {
        const result = await validatePlaywrightReplCode('import x from "node:fs"')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('import'))
    })

    test('rejects dynamic import call', async () => {
        const result = await validatePlaywrightReplCode('const mod = await import("node:fs")')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('import'))
    })

    test('rejects process reference', async () => {
        const result = await validatePlaywrightReplCode('const h = process.env.HOME')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('process'))
    })

    test('rejects globalThis.process reference', async () => {
        const result = await validatePlaywrightReplCode('const h = globalThis.process.env.HOME')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('process'))
    })

    test('does not reject string literal that contains forbidden words', async () => {
        const result = await validatePlaywrightReplCode('const text = \'require("fs") process.env import("x")\'\nawait Promise.resolve(text)')
        assert.strictEqual(result.ok, true)
    })

    test('allows local variable named process when not used as member object', async () => {
        const result = await validatePlaywrightReplCode('const process = { env: {} }\nawait Promise.resolve(process)')
        assert.strictEqual(result.ok, true)
    })

    test('rejects empty code', async () => {
        const result = await validatePlaywrightReplCode('   ')
        assert.strictEqual(result.ok, false)
    })
})
