import { strict as assert } from 'assert'
import { scanHtml, scanHtmlTag, scanMatchingHtmlTag } from '../../../src/chat/fixmathlib/fix'


suite('fixmath.scanHtmlTag', () => {

    test('non-tag index returns same index', () => {
        const txt = 'hello <b>bold</b>'
        const res = scanHtmlTag(txt, 0)
        assert.strictEqual(res, 0)
    })

    test('returns end index for opening tag with quoted > inside attribute', () => {
        const txt = '<a href="http://example.com?q=1>2">link</a>'
        const res = scanHtmlTag(txt, 0)
        const expected = txt.indexOf('">link') + 2
        assert.strictEqual(res, expected)
    })

    test('handles single-quoted attributes with > inside', () => {
        const txt = "<img alt='a > b' src='x'>rest"
        const res = scanHtmlTag(txt, 0)
        const expected = txt.indexOf("'>rest") + 2
        assert.strictEqual(res, expected)
    })

    test('handles html comments', () => {
        const txt = 'prefix <!-- a comment -->suffix'
        const start = txt.indexOf('<!--')
        const res = scanHtmlTag(txt, start)
        const expected = txt.indexOf('-->', start) + 3
        assert.strictEqual(res, expected)
    })

    test('handles cdata sections', () => {
        const txt = 'prefix <![CDATA[ some > data ]]> end'
        const start = txt.indexOf('<![CDATA[')
        const res = scanHtmlTag(txt, start)
        const expected = txt.indexOf(']]>', start) + 3
        assert.strictEqual(res, expected)
    })

    test('handles processing instructions', () => {
        const txt = '<?xml version="1.0"?>\n<root/>'
        const res = scanHtmlTag(txt, 0)
        const expected = txt.indexOf('?>') + 2
        assert.strictEqual(res, expected)
    })

    test('index out of range returns same index', () => {
        const txt = '<p>hello</p>'
        assert.strictEqual(scanHtmlTag(txt, txt.length), txt.length)
    })

    test('negative index treated as 0', () => {
        const txt = '<p>hi</p>'
        assert.strictEqual(scanHtmlTag(txt, -10), scanHtmlTag(txt, 0))
    })

    test('non-tag with no following < returns same index', () => {
        const txt = 'plain text no tags'
        assert.strictEqual(scanHtmlTag(txt, 0), 0)
    })

})


suite('fixmath.scanMatchingHtmlTag', () => {

    test('non-tag index returns index of next <', () => {
        const txt = 'hello <b>bold</b>'
        const res = scanMatchingHtmlTag(txt, 0)
        assert.strictEqual(res, 0)
    })

    test('simple tag returns end of closing tag', () => {
        const txt = '<p>hello</p>world'
        const res = scanMatchingHtmlTag(txt, 0)
        assert.strictEqual(res, txt.indexOf('</p>') + '</p>'.length)
    })

    test('nested same tags are matched correctly', () => {
        const txt = '<div><div>inner</div></div>rest'
        const res = scanMatchingHtmlTag(txt, 0)
        assert.strictEqual(res, txt.lastIndexOf('</div>') + '</div>'.length)
    })

    test('void tag returns end of start tag', () => {
        const txt = '<br>after'
        const res = scanMatchingHtmlTag(txt, 0)
        assert.strictEqual(res, txt.indexOf('<br>') + '<br>'.length)
    })

    test('comments are standalone', () => {
        const txt = 'prefix <!-- comment -->suffix'
        const start = txt.indexOf('<!--')
        const res = scanMatchingHtmlTag(txt, start)
        assert.strictEqual(res, txt.indexOf('-->', start) + 3)
    })

    test('negative index treated as 0', () => {
        const txt = '<p>hi</p>'
        assert.strictEqual(scanMatchingHtmlTag(txt, -10), scanMatchingHtmlTag(txt, 0))
    })

})

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


