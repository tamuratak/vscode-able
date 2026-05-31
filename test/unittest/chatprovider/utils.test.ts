import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { findRepeatingPattern } from '../../../src/chatprovider/opencodegochatprovider/utils.js'

suite('findRepeatingPattern', () => {
    test('detects simple repetition of a natural sentence', () => {
        const pattern = 'the quick brown fox jumps over the lazy dog near the river bank and watches the sunset carefully'
        const text = `${pattern} ${pattern} ${pattern}`
        const result = findRepeatingPattern(text)
        assert.ok(result)
        assert.strictEqual(result.count, 3)
        assert.strictEqual(result.pattern, pattern)
    })

    test('detects repetition with partial ending', () => {
        const pattern = 'the quick brown fox jumps over the lazy dog near the river bank and watches the sunset carefully'
        const words = pattern.split(' ')
        const partial = words.slice(0, 4).join(' ')
        const text = `${pattern} ${pattern} ${partial}`
        const result = findRepeatingPattern(text)
        assert.ok(result)
        assert.strictEqual(result.count, 2)
        assert.strictEqual(result.pattern, pattern)
    })

    test('detects repetition with prefix text', () => {
        const prefix = 'I was thinking about this problem for a long time and then realized that '
        const pattern = 'we need to analyze the data more carefully before making any decisions about the future of this project'
        const text = `${prefix}${pattern} ${pattern} ${pattern}`
        const result = findRepeatingPattern(text)
        assert.ok(result)
        assert.strictEqual(result.count, 3)
        assert.strictEqual(result.pattern, pattern)
    })

    test('detects repetition with a longer ~20 word pattern', () => {
        const words = Array.from({ length: 20 }, (_, i) => `word${i}`)
        const pattern = words.join(' ')
        const text = `some introductory text here ${pattern} ${pattern} ${pattern}`
        const result = findRepeatingPattern(text)
        assert.ok(result)
        assert.strictEqual(result.count, 3)
        assert.strictEqual(result.pattern, pattern)
    })

    test('returns null for text with no repetition', () => {
        const text = 'this is a completely unique sentence with no repeating patterns at all and every word is different from the others in a meaningful way'
        const result = findRepeatingPattern(text)
        assert.strictEqual(result, null)
    })

    test('returns null for short text', () => {
        const result = findRepeatingPattern('hello world')
        assert.strictEqual(result, null)
    })

    test('returns null for a single pattern occurrence', () => {
        const pattern = Array.from({ length: 20 }, (_, i) => `unique${i}`).join(' ')
        const result = findRepeatingPattern(pattern)
        assert.strictEqual(result, null)
    })

    test('detects repetition when the final occurrence is truncated mid-string', () => {
        const pattern = 'the quick brown fox jumps over the lazy dog near the river bank and watches the sunset carefully'
        const text = `${pattern} ${pattern} ${pattern.slice(0, 30)}`
        const result = findRepeatingPattern(text)
        assert.ok(result)
        assert.strictEqual(result.count, 2)
        assert.strictEqual(result.pattern, pattern)
    })

    test('detects four or more repetitions', () => {
        const pattern = 'analysis of the system shows that the performance metrics are consistent across all test cases'
        const text = `${pattern} ${pattern} ${pattern} ${pattern}`
        const result = findRepeatingPattern(text)
        assert.ok(result)
        assert.strictEqual(result.count, 4)
        assert.strictEqual(result.pattern, pattern)
    })

    test('handles text with varied vocabulary in the pattern', () => {
        const pattern = 'despite the overwhelming evidence suggesting otherwise the committee decided to proceed with the original plan without modification'
        const text = `introduction paragraph here ${pattern} ${pattern}`
        const result = findRepeatingPattern(text)
        assert.ok(result)
        assert.strictEqual(result.count, 2)
        assert.strictEqual(result.pattern, pattern)
    })
})
