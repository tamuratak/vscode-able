import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { parseRunnerMessage, RunnerConfig } from '../../../src/playwright_exec/runnermessage.js'

const defaultConfig: RunnerConfig = {
    browserType: 'chromium',
    headless: true
}

suite('runner message parser', () => {
    test('parses exec message', () => {
        const message = parseRunnerMessage('{"id":"1","type":"exec","code":"await 1"}', defaultConfig)
        assert.ok(message)
        assert.strictEqual(message?.type, 'exec')
        if (message && message.type === 'exec') {
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
        const message = parseRunnerMessage('{"id":"1","type":"init","config":{"browserType":"bad","headless":false}}', defaultConfig)
        assert.ok(message)
        assert.strictEqual(message?.type, 'init')
        if (message && message.type === 'init') {
            assert.strictEqual(message.config.browserType, 'chromium')
            assert.strictEqual(message.config.headless, false)
        }
    })
})
