import { strict as assert } from 'node:assert'
import { scanHtmlTag, extractMatchingHtmlTag, scanHtmlImpl } from '../../../src/chat/fixmathlib/html.js'


suite('fixmath.scanHtmlImpl', () => {

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
        assert.strictEqual(scanHtmlTag(txt, txt.length), 0)
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

suite('fixmath.extractMatchingHtmlTag', () => {

    test('non-tag index returns index of next <', () => {
        const txt = 'hello <b>bold</b>'
        const res = extractMatchingHtmlTag(txt, 0)
        assert.strictEqual(res, 0)
    })

    test('simple tag returns end of closing tag', () => {
        const txt = '<p>hello</p>world'
        const res = extractMatchingHtmlTag(txt, 0)
        assert.strictEqual(res, txt.indexOf('</p>') + '</p>'.length)
    })

    test('nested same tags are matched correctly', () => {
        const txt = '<div><div>inner</div></div>rest'
        const res = extractMatchingHtmlTag(txt, 0)
        assert.strictEqual(res, txt.lastIndexOf('</div>') + '</div>'.length)
    })

    test('void tag returns end of start tag', () => {
        const txt = '<br>after'
        const res = extractMatchingHtmlTag(txt, 0)
        assert.strictEqual(res, txt.indexOf('<br>') + '<br>'.length)
    })

    test('comments are standalone', () => {
        const txt = 'prefix <!-- comment -->suffix'
        const start = txt.indexOf('<!--')
        const res = extractMatchingHtmlTag(txt, start)
        assert.strictEqual(res, txt.indexOf('-->', start) + 3)
    })

    test('negative index treated as 0', () => {
        const txt = '<p>hi</p>'
        assert.strictEqual(extractMatchingHtmlTag(txt, -10), 0)
    })

})
