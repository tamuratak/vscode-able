import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { isAllowedUrl } from '../../../src/playwright_repl/playwrightrunner.js'

suite('playwright runner url policy', () => {
    test('always allows localhost when network is disabled', () => {
        const allowed = isAllowedUrl('http://localhost:3000')
        assert.strictEqual(allowed, true)
    })

    test('allows loopback addresses', () => {
        const ipv4Allowed = isAllowedUrl('http://127.0.0.1:3000')
        const ipv6Allowed = isAllowedUrl('http://[::1]:3000')
        assert.strictEqual(ipv4Allowed, true)
        assert.strictEqual(ipv6Allowed, true)
    })

    test('blocks external host', () => {
        const allowed = isAllowedUrl('https://example.com')
        assert.strictEqual(allowed, false)
    })
})
