import { strict as assert } from 'node:assert'
import { scanHtmlImpl } from '../../../src/chat/fixmathlib/utils.js'

suite('fixmath.scanHtmlTag2', () => {

    test('simple opening tag moves past closing bracket', () => {
        const txt = '<p>text'
        assert.strictEqual(scanHtmlImpl(txt, 0), txt.indexOf('>') + 1)
    })

    test('closing tag returns full closing', () => {
        const txt = '</p>text'
        assert.strictEqual(scanHtmlImpl(txt, 0), txt.indexOf('>') + 1)
    })

    test('self-closing tag with attributes matches end', () => {
        const txt = '<img src="image.png" alt="a > b" />rest'
        assert.strictEqual(scanHtmlImpl(txt, 0), txt.indexOf('/>') + 2)
    })

    test('index not at tag returns 0', () => {
        const txt = 'prefix <b>bold</b>'
        assert.strictEqual(scanHtmlImpl(txt, 0), 0)
    })

    test('non-tag at < returns 0', () => {
        const txt = '< invalid'
        assert.strictEqual(scanHtmlImpl(txt, 0), 0)
    })

})
