import { strict as assert } from 'assert'
import { scanHtml } from '../../../src/chat/fixmathlib/fix'

suite('fixmath.scanHtml', () => {

	test('non-tag returns up to next <', () => {
		const txt = 'hello <b>bold</b>'
		const res = scanHtml(txt, 0)
		assert.strictEqual(res, 'hello ')
	})

	test('returns opening tag including attributes with quoted >', () => {
		const txt = '<a href="http://example.com?q=1>2">link</a>'
		const res = scanHtml(txt, 0)
		assert.strictEqual(res, '<a href="http://example.com?q=1>2">')
	})

	test('handles single-quoted attributes with > inside', () => {
		const txt = "<img alt='a > b' src='x'>rest"
		const res = scanHtml(txt, 0)
		assert.strictEqual(res, "<img alt='a > b' src='x'>")
	})

	test('handles html comments', () => {
		const txt = 'prefix <!-- a comment -->suffix'
		const start = txt.indexOf('<!--')
		const res = scanHtml(txt, start)
		assert.strictEqual(res, '<!-- a comment -->')
	})

	test('handles cdata sections', () => {
		const txt = 'prefix <![CDATA[ some > data ]]> end'
		const start = txt.indexOf('<![CDATA[')
		const res = scanHtml(txt, start)
		assert.strictEqual(res, '<![CDATA[ some > data ]]>')
	})

	test('handles processing instructions', () => {
		const txt = '<?xml version="1.0"?>\n<root/>'
		const res = scanHtml(txt, 0)
		assert.strictEqual(res, '<?xml version="1.0"?>')
	})

	test('index out of range returns empty string', () => {
		const txt = '<p>hello</p>'
		assert.strictEqual(scanHtml(txt, txt.length), '')
	})

	test('negative index treated as 0', () => {
		const txt = '<p>hi</p>'
		assert.strictEqual(scanHtml(txt, -10), '<p>')
	})

	test('non-tag with no following < returns rest', () => {
		const txt = 'plain text no tags'
		assert.strictEqual(scanHtml(txt, 0), 'plain text no tags')
	})

})
