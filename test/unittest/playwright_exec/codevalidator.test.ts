import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { validatePlaywrightExecCode } from '../../../src/playwright_exec/codevalidator.js'

suite('playwright exec code validator', () => {
    test('accepts simple async code', async () => {
        const result = await validatePlaywrightExecCode('await Promise.resolve(1)')
        assert.strictEqual(result.ok, true)
    })

    test('rejects require call', async () => {
        const result = await validatePlaywrightExecCode('const fs = require("fs")')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('require'))
    })

    test('rejects import statement', async () => {
        const result = await validatePlaywrightExecCode('import x from "node:fs"')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('import'))
    })

    test('rejects dynamic import call', async () => {
        const result = await validatePlaywrightExecCode('const mod = await import("node:fs")')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('import'))
    })

    test('rejects process reference', async () => {
        const result = await validatePlaywrightExecCode('const h = process.env.HOME')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('process'))
    })

    test('rejects globalThis.process reference', async () => {
        const result = await validatePlaywrightExecCode('const h = globalThis.process.env.HOME')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('process'))
    })

    test('does not reject string literal that contains forbidden words', async () => {
        const result = await validatePlaywrightExecCode('const text = \'require("fs") process.env import("x")\'\nawait Promise.resolve(text)')
        assert.strictEqual(result.ok, true)
    })

    test('rejects constructor property access with dot syntax', async () => {
        const result = await validatePlaywrightExecCode('const f = ({ a: 1 }).constructor\nawait Promise.resolve(f)')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('constructor'))
    })

    test('rejects constructor property access with optional chaining syntax', async () => {
        const result = await validatePlaywrightExecCode('const target = undefined\nconst v = target?.constructor\nawait Promise.resolve(v)')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('constructor'))
    })

    test('rejects constructor property access with bracket syntax', async () => {
        const result = await validatePlaywrightExecCode('const obj = { a: 1 }\nconst f = obj["constructor"]\nawait Promise.resolve(f)')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('constructor'))
    })

    test('does not reject string literal containing constructor text', async () => {
        const result = await validatePlaywrightExecCode('const msg = "obj.constructor and obj[\\"constructor\\"]"\nawait Promise.resolve(msg)')
        assert.strictEqual(result.ok, true)
    })

    test('rejects __proto__ access', async () => {
        const result = await validatePlaywrightExecCode('const p = ({ a: 1 }).__proto__\nawait Promise.resolve(p)')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('__proto__'))
    })

    test('rejects Symbol.species reference', async () => {
        const result = await validatePlaywrightExecCode('const v = Symbol.species\nawait Promise.resolve(v)')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('species'))
    })

    test('rejects Object.setPrototypeOf call', async () => {
        const result = await validatePlaywrightExecCode('const a = {}\nObject.setPrototypeOf(a, null)')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('setPrototypeOf'))
    })

    test('rejects Object.prototype defineProperty call', async () => {
        const result = await validatePlaywrightExecCode('Object.defineProperty(Object.prototype, "x", { get() { return 1 } })')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('Object.prototype'))
    })

    test('allows local variable named process when not used as member object', async () => {
        const result = await validatePlaywrightExecCode('const process = { env: {} }\nawait Promise.resolve(process)')
        assert.strictEqual(result.ok, true)
    })

    test('rejects empty code', async () => {
        const result = await validatePlaywrightExecCode('   ')
        assert.strictEqual(result.ok, false)
    })
})
