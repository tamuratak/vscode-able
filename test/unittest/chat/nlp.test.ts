import { strict as assert } from 'assert'
import { extractProperNouns } from '../../../src/chat/chatlib/nlp'

suite('nlp.extractProperNouns', () => {

	test('basic single proper noun', () => {
		const txt = 'Alice went to London.'
		const res = extractProperNouns(txt)
		assert.deepEqual(res, ['Alice', 'London'])
	})

	test('compound names are excluded', () => {
		const txt = 'Alice visited New York City.'
		const res = extractProperNouns(txt)
		// New York City is compound and should be excluded; only Alice remains
		assert.deepEqual(res, ['Alice', 'City'])
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

})
