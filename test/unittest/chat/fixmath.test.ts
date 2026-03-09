import { strict as assert } from 'node:assert'
import { scanHtml } from '../../../src/chat/fixmathlib/fix.js'
import { convertTableToMarkdown } from '../../../src/chat/fixmathlib/table.js'


suite('fixmath.scanHtml', () => {

    test('plain text no tags', () => {
        const txt = 'plain text no tags'
        const res = scanHtml(txt)
        assert.deepStrictEqual(res, ['plain text no tags'])
    })

    test('text with inline tag', () => {
        const txt = 'hello <b>bold</b>'
        const res = scanHtml(txt)
        assert.deepStrictEqual(res, ['hello ', 'bold'])
    })

    test('leading tag and trailing text', () => {
        const txt = '<p>hello</p>world'
        const res = scanHtml(txt)
        assert.deepStrictEqual(res, ['hello', 'world'])
    })

    test('comments are ignored', () => {
        const txt = 'prefix <!-- comment -->suffix'
        const res = scanHtml(txt)
        assert.deepStrictEqual(res, ['prefix ', 'suffix'])
    })

})

suite('fixmath.convertTableToMarkdown', () => {

    test('converts simple thead table to markdown', () => {
        const tableHtml = '<table><thead><tr><th>Header</th><th>Value</th></tr></thead><tbody><tr><td>Cell</td><td><a href="https://example.com">link</a></td></tr><tr><td>Another</td><td>42</td></tr></tbody></table>'
        const expected = '| Header | Value |\n| --- | --- |\n| Cell | [link](https://example.com) |\n| Another | 42 |'
        assert.strictEqual(convertTableToMarkdown(tableHtml), expected)
    })

    test('uses first row as header when no thead exists', () => {
        const tableHtml = '<table><tr><td>R1</td><td>R2</td></tr><tr><td>A</td><td>B</td></tr></table>'
        const expected = '| R1 | R2 |\n| --- | --- |\n| A | B |'
        assert.strictEqual(convertTableToMarkdown(tableHtml), expected)
    })

    test('returns empty string when table has no cells', () => {
        const tableHtml = '<table></table>'
        assert.strictEqual(convertTableToMarkdown(tableHtml), '')
    })

    test('pads header row when body expands columns', () => {
        const tableHtml = '<table><tr><th>Alpha</th><th>Beta</th></tr><tbody><tr><td>1</td><td>2</td><td>3</td></tr></tbody></table>'
        const expected = '| Alpha | Beta |  |\n| --- | --- | --- |\n| 1 | 2 | 3 |'
        assert.strictEqual(convertTableToMarkdown(tableHtml), expected)
    })

    test('escapes pipes and normalizes whitespace in cells', () => {
        const tableHtml = '<table><tr><th>Pipe|Header</th><th>Line</th></tr><tr><td>  a | b  </td><td><span>  spaced\ntext</span></td></tr></table>'
        const expected = '| Pipe\\|Header | Line |\n| --- | --- |\n| a \\| b | spaced text |'
        assert.strictEqual(convertTableToMarkdown(tableHtml), expected)
    })

})
