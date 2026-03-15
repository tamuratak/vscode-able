import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { accumulateScreenshotBytes } from '../../../src/playwright_repl/screenshotlimits.js'

suite('playwright repl screenshot limits', () => {
    test('returns accumulated bytes when within per image and total limits', () => {
        const total = accumulateScreenshotBytes(100, 200, 300, 1000)
        assert.strictEqual(total, 300)
    })

    test('allows exact per image and total boundaries', () => {
        const total = accumulateScreenshotBytes(700, 300, 300, 1000)
        assert.strictEqual(total, 1000)
    })

    test('throws when a screenshot exceeds per image limit', () => {
        assert.throws(() => {
            accumulateScreenshotBytes(0, 301, 300, 1000)
        }, /screenshot too large/i)
    })

    test('throws when accumulated total exceeds total limit', () => {
        assert.throws(() => {
            accumulateScreenshotBytes(800, 201, 300, 1000)
        }, /total screenshot bytes exceeded/i)
    })
})
