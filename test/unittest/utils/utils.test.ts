import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { deepEqual } from '../../../src/utils/utils.js'

suite('deepEqual tests', () => {
    test('primitive equality', () => {
        assert.strictEqual(deepEqual(1, 1), true)
        assert.strictEqual(deepEqual('abc', 'abc'), true)
        assert.strictEqual(deepEqual(true, true), true)
    })

    test('primitive inequality', () => {
        assert.strictEqual(deepEqual(1, 2), false)
        assert.strictEqual(deepEqual('abc', 'def'), false)
        assert.strictEqual(deepEqual(true, false), false)
    })

    test('object equality', () => {
        const a = { x: 1, y: { z: 2 } }
        const b = { x: 1, y: { z: 2 } }
        assert.strictEqual(deepEqual(a, b), true)
    })

    test('object inequality', () => {
        const a = { x: 1, y: { z: 2 } }
        const b = { x: 1, y: { z: 3 } }
        assert.strictEqual(deepEqual(a, b), false)
    })

    test('array equality', () => {
        assert.strictEqual(deepEqual([1, 2, 3], [1, 2, 3]), true)
    })

    test('array inequality', () => {
        assert.strictEqual(deepEqual([1, 2, 3], [1, 2, 4]), false)
    })

    test('different types', () => {
        assert.strictEqual(deepEqual(1, '1'), false)
        assert.strictEqual(deepEqual(null, undefined), false)
    })

    test('nested arrays and objects', () => {
        const a = { arr: [{ foo: 'bar' }, { baz: 3 }], nested: { a: 1 } }
        const b = { arr: [{ foo: 'bar' }, { baz: 3 }], nested: { a: 1 } }
        assert.strictEqual(deepEqual(a, b), true)
    })
})
