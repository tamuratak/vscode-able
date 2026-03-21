import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { isAllowedUrl } from '../../../src/playwright_exec/playwrightrunner.js'

suite('playwright runner url policy', () => {
    test('allows localhost inside allowed port range', () => {
        const allowed = isAllowedUrl('http://localhost:3000')
        assert.strictEqual(allowed, true)
    })

    test('allows loopback addresses inside allowed port range', () => {
        const ipv4Allowed = isAllowedUrl('http://127.0.0.1:3000')
        const ipv6Allowed = isAllowedUrl('http://[::1]:3010')
        assert.strictEqual(ipv4Allowed, true)
        assert.strictEqual(ipv6Allowed, true)
    })

    test('blocks localhost outside allowed port range', () => {
        const tooLowPort = isAllowedUrl('http://localhost:2999')
        const tooHighPort = isAllowedUrl('http://localhost:3011')
        assert.strictEqual(tooLowPort, false)
        assert.strictEqual(tooHighPort, false)
    })

    test('blocks url without explicit port', () => {
        const allowed = isAllowedUrl('http://localhost')
        assert.strictEqual(allowed, false)
    })

    test('blocks external host', () => {
        const allowed = isAllowedUrl('https://example.com')
        assert.strictEqual(allowed, false)
    })

    test('blocks non-http schemes', () => {
        const aboutAllowed = isAllowedUrl('about:blank')
        const dataAllowed = isAllowedUrl('data:text/plain,hello')
        assert.strictEqual(aboutAllowed, false)
        assert.strictEqual(dataAllowed, false)
    })
})
