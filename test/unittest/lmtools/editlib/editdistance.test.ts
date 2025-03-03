import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { calculateEditDistance, findBestMatches } from '../../../../src/lmtools/editlib/editdistance.js'


suite('calculateeditdistance tests', () => {
    test('both arrays empty returns 0', () => {
        const result = calculateEditDistance([], [])
        assert.strictEqual(result, 0)
    })

    test('first array empty returns length of second array', () => {
        const result = calculateEditDistance([], ['a', 'b', 'c'])
        assert.strictEqual(result, 3)
    })

    test('second array empty returns length of first array', () => {
        const result = calculateEditDistance(['a', 'b', 'c'], [])
        assert.strictEqual(result, 3)
    })

    test('identical arrays return 0', () => {
        const array = ['foo', 'bar', 'baz']
        const result = calculateEditDistance(array, array)
        assert.strictEqual(result, 0)
    })

    test('single substitution returns 1', () => {
        const result = calculateEditDistance(['a', 'b'], ['a', 'c'])
        assert.strictEqual(result, 1)
    })
})

suite('findBestMatches tests', () => {
    test('empty document returns empty array', () => {
        const result = findBestMatches('', 'hello world')
        assert.deepStrictEqual(result, [])
    })

    test('empty search string returns empty array', () => {
        const result = findBestMatches('hello world', '')
        assert.deepStrictEqual(result, [])
    })

    test('exact match returns correct position', () => {
        const doc = 'This is a test document with some text'
        const search = 'test document'
        const result = findBestMatches(doc, search)
        assert.deepStrictEqual(result, [[10, 23]])
    })

    test('multiple exact matches returns all positions', () => {
        const doc = 'repeat text repeat text'
        const search = 'repeat text'
        const result = findBestMatches(doc, search)
        assert.deepStrictEqual(result, [[0, 11], [12, 23]])
    })

    test('search longer than document returns empty', () => {
        const doc = 'short text'
        const search = 'very long search text that exceeds document'
        const result = findBestMatches(doc, search)
        assert.deepStrictEqual(result, [])
    })

    test('match with leading and trailing whitespace', () => {
        const doc = '  This  is  a  test  '
        const search = 'This is a test'
        const result = findBestMatches(doc, search)
        assert.deepStrictEqual(result, [[2, 19]])
    })

    test('match with extra whitespace between words', () => {
        const doc = 'This     is    a    test'
        const search = 'This is a test'
        const result = findBestMatches(doc, search)
        assert.deepStrictEqual(result, [[0, 24]])
    })

    test('find match in long text with multiple paragraphs', () => {
        const doc = `
        Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nullam auctor, 
        nisl eget ultricies lacinia, nisl nisl aliquet nisl, eget ultricies
        nisl nisl eget ultricies. Nullam auctor, nisl eget ultricies lacinia.

        The quick brown fox jumps over the lazy dog. The quick brown fox jumps
        over the lazy dog. The quick brown fox jumps over the lazy dog.

        Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium
        doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore
        veritatis et quasi architecto beatae vitae dicta sunt explicabo.
        `
        const search = 'quick brown fox jumps'
        const result = findBestMatches(doc, search)

        assert.strictEqual(result.length, 3)
        for (const [start, end] of result) {
            const match = doc.substring(start, end)
            assert.ok(match.includes('quick brown fox jumps'))
        }
    })

    test('find best match with insertions and deletions', () => {
        const doc = 'The developer wrote complex code for the application'
        const search = 'developer writes code for application'
        const result = findBestMatches(doc, search)
        assert.strictEqual(result.length, 1)

        const [start, end] = result[0]
        const match = doc.substring(start, end)
        assert.ok(match.includes('developer wrote complex code for the application'))
    })

    test('handle very long document with match at the end', () => {
        const uniqueTarget = 'unique target phrase'
        let longDoc = ''
        for (let i = 0; i < 100; i++) {
            longDoc += `Paragraph ${i}: This is some repetitive text to create a long document. `
        }
        longDoc += `${uniqueTarget} is here at the end.`

        const search = uniqueTarget
        const result = findBestMatches(longDoc, search)

        assert.strictEqual(result.length, 1)
        const [start, end] = result[0]
        const match = longDoc.substring(start, end)
        assert.ok(match.includes(uniqueTarget))
    })

    test('handle very long input with multiple close matches', () => {
        // Create a document with three similar but slightly different phrases
        const longText = `
        ${'-'.repeat(1000)}
        This is version one of the target text we want to find
        ${'-'.repeat(1000)}
        This is version two of the target text we need to find
        ${'-'.repeat(1000)}
        This is version three of the target text we will find
        ${'-'.repeat(1000)}
        `

        const search = 'This is version of the target text we want to find'
        const result = findBestMatches(longText, search)

        // Should find at least one match
        assert.ok(result.length >= 1)

        // Check that matches are meaningful
        for (const [start, end] of result) {
            const match = longText.substring(start, end)
            assert.ok(
                match.includes('version one') ||
                match.includes('version two') ||
                match.includes('version three')
            )
        }
    })

    test('handles text with special characters and punctuation', () => {
        const doc = 'Text with special-characters: punctuation, numbers (123) and "quotes"!'
        const search = 'special characters punctuation numbers'
        const result = findBestMatches(doc, search)

        assert.notStrictEqual(result.length, 1)
    })

})
