import { strict as assert } from 'assert'
import { extractProperNouns, parseNameMap } from '../../../src/chat/chatlib/nlp'

suite('nlp.extractProperNouns', () => {

	test('basic single proper noun', () => {
		const txt = 'Alice went to London.'
		const res = extractProperNouns(txt)
		assert.deepEqual(res, ['Alice', 'London'])
	})

	test('compound names are excluded', () => {
		const txt = 'Alice visited New York City.'
		const res = extractProperNouns(txt)
		assert.deepEqual(res, ['Alice', 'New', 'York', 'City'])
	})

	test('exclude abbreviations and honorifics', () => {
		const txt = 'Mr. Smith met Dr. Jones. NASA launched a rocket.'
		const res = extractProperNouns(txt)
		// Mr., Dr., NASA excluded; Smith remains (Jones part of compound with Dr.?)
		assert.deepEqual(res, ['Smith', 'Jones'])
	})

	test('allow hyphen and apostrophe names', () => {
		const txt = "O'Connor met Jean-Paul in Paris."
		const res = extractProperNouns(txt)
		// both O'Connor and Jean-Paul are single-token names and allowed
		assert.deepEqual(res, ["O'Connor", 'Jean-Paul', 'Paris'])
	})

	test('do not normalize possessives', () => {
		const txt = "Alice's book was read by Bob."
		const res = extractProperNouns(txt)
		// per spec we do not normalize possessives, so Alice's remains
		assert.deepEqual(res, ['Alice', 'Bob'])
	})

	test('dedupe and preserve order', () => {
		const txt = 'Alice met Bob. Bob and Alice went home.'
		const res = extractProperNouns(txt)
		assert.deepEqual(res, ['Alice', 'Bob'])
	})

	test('exclude all-uppercase acronyms', () => {
		const txt = 'Alice met NASA and CHARLIE and Dave.'
		const res = extractProperNouns(txt)
		// NASA and CHARLIE are all-uppercase and should be excluded
		assert.deepEqual(res, ['Alice', 'Dave'])
	})

	test('exclude tokens containing digits', () => {
		const txt = 'Alice visited Area51 and Bob2 and Carol.'
		const res = extractProperNouns(txt)
		// Area51 and Bob2 contain digits and should be excluded
		assert.deepEqual(res, ['Alice', 'Carol'])
	})

	test('exclude markdown syntax', () => {
		const txt = '[Alice\'s] book.'
		const res = extractProperNouns(txt)
		// NASA and CHARLIE are all-uppercase and should be excluded
		assert.deepEqual(res, ['Alice'])
	})

		test('mote test 01', () => {
		const txt = 'Some of Mark Bob\'s friends.'
		const res = extractProperNouns(txt)
		// NASA and CHARLIE are all-uppercase and should be excluded
		assert.deepEqual(res, ['Some', 'Mark', 'Bob'])
	})

})

suite('nlp.parseNameMap', () => {

	test('basic parsing with bullets and plain lines', () => {
		const txt = `- Alice: アリス
- Bob: ボブ
- Carol: キャロル
- Dave: デイブ
- Eve: イヴ`
		const m = parseNameMap(txt)
		assert.strictEqual(m.get('Alice'), 'アリス')
		assert.strictEqual(m.get('Bob'), 'ボブ')
		assert.strictEqual(m.get('Carol'), 'キャロル')
		assert.strictEqual(m.get('Dave'), 'デイブ')
		assert.strictEqual(m.get('Eve'), 'イヴ')
	})

	test('overwrite behavior and skipping invalid lines', () => {
		const txt = `- Alice: アリス
	Alice: アリス2
	- NoColonLine
	UnknownLine`
		const m = parseNameMap(txt)
		assert.strictEqual(m.get('Alice'), 'アリス2')
		assert.strictEqual(m.has('NoColonLine'), false)
		assert.strictEqual(m.has('UnknownLine'), false)
	})

})
