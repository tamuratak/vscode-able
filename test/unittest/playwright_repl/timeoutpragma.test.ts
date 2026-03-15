import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { extractTimeoutOverrideMs } from '../../../src/playwright_repl/timeoutpragma.js'

suite('playwright repl timeout pragma', () => {
    test('parses valid timeout pragma', () => {
        const value = extractTimeoutOverrideMs('// playwrightrepl-timeout=2500\nawait pw.page.title()')
        assert.strictEqual(value, 2500)
    })

    test('returns undefined when pragma not found', () => {
        const value = extractTimeoutOverrideMs('await pw.page.title()')
        assert.strictEqual(value, undefined)
    })

    test('returns undefined when below minimum', () => {
        const value = extractTimeoutOverrideMs('// playwrightrepl-timeout=99')
        assert.strictEqual(value, undefined)
    })

    test('returns undefined when above maximum', () => {
        const value = extractTimeoutOverrideMs('// playwrightrepl-timeout=70000')
        assert.strictEqual(value, undefined)
    })

    test('accepts minimum and maximum boundary values', () => {
        const minValue = extractTimeoutOverrideMs('// playwrightrepl-timeout=100')
        const maxValue = extractTimeoutOverrideMs('// playwrightrepl-timeout=60000')

        assert.strictEqual(minValue, 100)
        assert.strictEqual(maxValue, 60000)
    })

    test('returns undefined when pragma is not in the first line', () => {
        const value = extractTimeoutOverrideMs('await pw.page.title()\n// playwrightrepl-timeout=2500')
        assert.strictEqual(value, undefined)
    })

    test('returns undefined for malformed pragma value', () => {
        const decimalValue = extractTimeoutOverrideMs('// playwrightrepl-timeout=2500.5')
        const suffixValue = extractTimeoutOverrideMs('// playwrightrepl-timeout=2500ms')

        assert.strictEqual(decimalValue, undefined)
        assert.strictEqual(suffixValue, undefined)
    })
})
