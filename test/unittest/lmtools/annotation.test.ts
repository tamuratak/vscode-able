import { strict as assert } from 'assert'
import { parseVarMatchesFromText } from '../../../src/lmtools/annotationlib/annotationparser'

suite('parseVarMatchesFromText', () => {
    test('extracts simple declarations', () => {
    const src = 'const a = 1\nlet b = 2'
        const matches = parseVarMatchesFromText(src)
        const names = matches.map(m => m.varname)
        assert.deepStrictEqual(names, ['a', 'b'])
        assert.strictEqual(matches[0].localLine, 0)
        assert.strictEqual(matches[1].localLine, 1)
    })

    test('extracts object destructuring and renames', () => {
    const src = 'const { id, value: v, x = 3 } = obj'
        const matches = parseVarMatchesFromText(src)
        const names = matches.map(m => m.varname)
        // should capture id and v (value: v) and x
        assert.deepStrictEqual(names, ['id', 'v', 'x'])
        for (const m of matches) {
            assert.strictEqual(m.localLine, 0)
            assert.ok(m.localCol >= 0)
            assert.ok(m.localIndexInText >= 0)
        }
    })

    test('extracts array destructuring', () => {
    const src = 'const [x, , y] = arr'
        const matches = parseVarMatchesFromText(src)
        const names = matches.map(m => m.varname)
        assert.deepStrictEqual(names, ['x', 'y'])
    })

    test('extracts for-of and for-await variables', () => {
    const src = 'for (const it of items) { }\nfor await (const e of es) { }'
        const matches = parseVarMatchesFromText(src)
        const names = matches.map(m => m.varname)
        assert.deepStrictEqual(names, ['it', 'e'])
        assert.strictEqual(matches[0].localLine, 0)
        assert.strictEqual(matches[1].localLine, 1)
    })

    test('extracts catch parameter', () => {
    const src = 'try { } catch (err) {}'
        const matches = parseVarMatchesFromText(src)
        const names = matches.map(m => m.varname)
        assert.deepStrictEqual(names, ['err'])
    })

    test('extracts arrow-function parameters inside calls', () => {
    const src = 'v.mthd((a,b) => { })'
        const matches = parseVarMatchesFromText(src)
        const names = matches.map(m => m.varname)
        assert.deepStrictEqual(names, ['a', 'b'])
        for (const m of matches) {
            assert.strictEqual(m.localLine, 0)
            assert.ok(m.localCol >= 0)
            assert.ok(m.localIndexInText >= 0)
        }
    })
})
