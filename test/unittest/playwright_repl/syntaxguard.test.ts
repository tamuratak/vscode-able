import * as assert from 'node:assert'
import { suite, teardown, test } from 'mocha'
import { findFirstBannedSyntax, forcesyntaxguardinitfailurefortest, restoresyntaxguardfortest } from '../../../src/playwright_repl/syntaxguard.js'

suite('playwright repl syntax guard', () => {
    teardown(() => {
        restoresyntaxguardfortest()
    })

    test('blocks import declaration', async () => {
        const violation = await findFirstBannedSyntax("import fs from 'node:fs'")
        assert.ok(violation)
        assert.strictEqual(violation.ruleid, 'import.statement')
    })

    test('blocks require call', async () => {
        const violation = await findFirstBannedSyntax("const fs = require('node:fs')")
        assert.ok(violation)
        assert.strictEqual(violation.ruleid, 'require.call')
    })

    test('blocks eval call', async () => {
        const violation = await findFirstBannedSyntax("eval('1 + 1')")
        assert.ok(violation)
        assert.strictEqual(violation.ruleid, 'eval.call')
    })

    test('blocks dynamic import call', async () => {
        const violation = await findFirstBannedSyntax("await import('node:fs')")
        assert.ok(violation)
        assert.strictEqual(violation.ruleid, 'import.dynamic')
    })

    test('blocks import.meta', async () => {
        const violation = await findFirstBannedSyntax('console.log(import.meta.url)')
        assert.ok(violation)
        assert.strictEqual(violation.ruleid, 'import.meta')
    })

    test('blocks new Function', async () => {
        const violation = await findFirstBannedSyntax("new Function('return 1')")
        assert.ok(violation)
        assert.strictEqual(violation.ruleid, 'function.constructor')
    })

    test('allows top level await style code', async () => {
        const violation = await findFirstBannedSyntax("await pw.page.goto('https://example.com')")
        assert.strictEqual(violation, undefined)
    })

    test('blocks string timer argument', async () => {
        const violation = await findFirstBannedSyntax("setTimeout('console.log(1)', 10)")
        assert.ok(violation)
        assert.strictEqual(violation.ruleid, 'timer.string')
    })

    test('blocks string interval argument', async () => {
        const violation = await findFirstBannedSyntax("setInterval('console.log(1)', 10)")
        assert.ok(violation)
        assert.strictEqual(violation.ruleid, 'timer.string')
    })

    test('fails closed when parser is unavailable', async () => {
        forcesyntaxguardinitfailurefortest()

        const violation = await findFirstBannedSyntax('const safe = 1')
        assert.ok(violation)
        assert.strictEqual(violation.ruleid, 'guard.init_failed')
    })
})
