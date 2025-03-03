import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { calculateEditDistance } from '../../../../src/lmtools/editlib/editdistance.js'


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
