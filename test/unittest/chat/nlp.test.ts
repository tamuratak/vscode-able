import { strict as assert } from 'assert'
import { extractProperNouns, parseNameMap, checkIfPlural, removePluralForms } from '../../../src/chat/chatlib/nlp'

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
		const txt = '[Alice\'s](link) book.'
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

suite('nlp.isPluralOf', () => {

	test('regular +s', () => {
		assert.strictEqual(checkIfPlural('cat', 'cats'), true)
		assert.strictEqual(checkIfPlural('Cat', 'CATS'), true)
		assert.strictEqual(checkIfPlural('book', 'books'), true)
		assert.strictEqual(checkIfPlural('book', 'book'), false)
	})

	test('sibilant +es', () => {
		assert.strictEqual(checkIfPlural('bus', 'buses'), true)
		assert.strictEqual(checkIfPlural('box', 'boxes'), true)
		assert.strictEqual(checkIfPlural('church', 'churches'), true)
		assert.strictEqual(checkIfPlural('brush', 'brushes'), true)
	})

	test('z ending doubling', () => {
		assert.strictEqual(checkIfPlural('buzz', 'buzzes'), true)
	})

	test('consonant + y -> ies', () => {
		assert.strictEqual(checkIfPlural('city', 'cities'), true)
		assert.strictEqual(checkIfPlural('baby', 'babies'), true)
		assert.strictEqual(checkIfPlural('key', 'keys'), true) // vowel + y
	})

	test('-f/-fe -> -ves (and allow +s alternates)', () => {
		assert.strictEqual(checkIfPlural('knife', 'knives'), true)
		assert.strictEqual(checkIfPlural('life', 'lives'), true)
		assert.strictEqual(checkIfPlural('roof', 'roofs'), true) // alternate +s
		assert.strictEqual(checkIfPlural('wolf', 'wolves'), true)
	})

	test('o ending', () => {
		assert.strictEqual(checkIfPlural('piano', 'pianos'), true)
		assert.strictEqual(checkIfPlural('photo', 'photos'), true)
	})

	test('negatives', () => {
		assert.strictEqual(checkIfPlural('data', 'datum'), false)
		assert.strictEqual(checkIfPlural('cats', 'cat'), false)
		assert.strictEqual(checkIfPlural('', 'cats'), false)
		assert.strictEqual(checkIfPlural('cat', ''), false)
		assert.strictEqual(checkIfPlural('bus', 'buss'), false)
	})
})

suite('nlp.removePluralForms', () => {
	test('removes simple +s plurals', () => {
		const inp = ['cat', 'cats', 'dog', 'dogs', 'book']
		const out = removePluralForms(inp)
		assert.deepEqual(out, ['cat', 'dog', 'book'])
	})

	test('removes es/ies/ves plurals and preserves order', () => {
		const inp = ['bus', 'buses', 'city', 'cities', 'knife', 'knives', 'roof', 'roofs']
		const out = removePluralForms(inp)
		assert.deepEqual(out, ['bus', 'city', 'knife', 'roof'])
	})

	test('case-insensitive match', () => {
		const inp = ['Cat', 'CATS', 'DOGS', 'dog']
		const out = removePluralForms(inp)
		assert.deepEqual(out, ['Cat', 'dog'])
	})

	test('ignores empty and non-strings', () => {
		const inp = ['cat', '', 'cats', '  ', 'book']
		const out = removePluralForms(inp)
		assert.deepEqual(out, ['cat', '', '  ', 'book'])
	})
})
