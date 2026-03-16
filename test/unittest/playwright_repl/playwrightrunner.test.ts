import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { isAllowedUrl, normalizeAllowedHosts } from '../../../src/playwright_repl/playwrightrunner.js'

suite('playwright runner url policy', () => {
    test('always allows localhost when network is disabled', () => {
        const allowed = isAllowedUrl('http://localhost:3000', false, [])
        assert.strictEqual(allowed, true)
    })

    test('blocks external host when network is disabled', () => {
        const allowed = isAllowedUrl('https://example.com', false, [])
        assert.strictEqual(allowed, false)
    })

    test('allows all hosts when network is enabled and allowlist is empty', () => {
        const allowed = isAllowedUrl('https://example.com', true, [])
        assert.strictEqual(allowed, true)
    })

    test('allows only allowlisted host when network is enabled and allowlist exists', () => {
        const allowed = isAllowedUrl('https://example.com', true, ['example.com'])
        const blocked = isAllowedUrl('https://microsoft.com', true, ['example.com'])
        assert.strictEqual(allowed, true)
        assert.strictEqual(blocked, false)
    })

    test('normalizes and deduplicates hosts', () => {
        const hosts = normalizeAllowedHosts(['Example.com', 'example.com', ' localhost '])
        assert.ok(hosts.includes('example.com'))
        assert.ok(hosts.includes('localhost'))
        assert.ok(hosts.includes('127.0.0.1'))
    })
})
