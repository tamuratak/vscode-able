import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { parseRunnerMessage, RunnerConfig } from '../../../src/playwright_repl/runnermessage.js'

const defaultConfig: RunnerConfig = {
    browserType: 'chromium',
    headless: true,
    networkAllow: false,
    allowedHosts: [],
    timeoutMs: 15000,
    maxOutputBytes: 16384,
    maxScreenshotBytes: 1024 * 1024,
    screenshotDefaultFormat: 'jpeg'
}

suite('runner message parser', () => {
    test('parses exec message with timeout', () => {
        const message = parseRunnerMessage('{"id":"1","type":"exec","code":"await 1","timeoutMs":2000}', defaultConfig)
        assert.ok(message)
        assert.strictEqual(message?.type, 'exec')
        if (message && message.type === 'exec') {
            assert.strictEqual(message.timeoutMs, 2000)
            assert.strictEqual(message.code, 'await 1')
        }
    })

    test('returns undefined for invalid json', () => {
        const message = parseRunnerMessage('{', defaultConfig)
        assert.strictEqual(message, undefined)
    })

    test('returns undefined for unknown type', () => {
        const message = parseRunnerMessage('{"id":"1","type":"unknown"}', defaultConfig)
        assert.strictEqual(message, undefined)
    })

    test('parses init message and falls back invalid config values', () => {
        const message = parseRunnerMessage('{"id":"1","type":"init","config":{"browserType":"bad","headless":false,"networkAllow":true,"allowedHosts":["example.com"],"timeoutMs":1,"maxOutputBytes":2,"maxScreenshotBytes":3,"screenshotDefaultFormat":"bad"}}', defaultConfig)
        assert.ok(message)
        assert.strictEqual(message?.type, 'init')
        if (message && message.type === 'init') {
            assert.strictEqual(message.config.browserType, 'chromium')
            assert.strictEqual(message.config.headless, false)
            assert.strictEqual(message.config.networkAllow, true)
            assert.deepStrictEqual(message.config.allowedHosts, ['example.com'])
            assert.strictEqual(message.config.timeoutMs, 1)
            assert.strictEqual(message.config.maxOutputBytes, 2)
            assert.strictEqual(message.config.maxScreenshotBytes, 3)
            assert.strictEqual(message.config.screenshotDefaultFormat, 'jpeg')
        }
    })
})
