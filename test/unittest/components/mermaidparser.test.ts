import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { parseMermaidClassDiagram } from '../../../src/components/mermaidparser.js'

suite('mermaid parser', () => {
	test('captures classes with attributes and relations', () => {
		const diagram = `classDiagram
class Foo {
	+bar: Bar
	+callBar()
}
class Bar {
	+doSomething()
}
Foo <|-- Bar
Foo ..> Bar : calls
`
		const parsed = parseMermaidClassDiagram(diagram)
		assert.strictEqual(parsed.classes.length, 2)
		const foo = parsed.classes.find((entry) => entry.name === 'Foo')
		assert.ok(foo)
		assert.deepStrictEqual(foo?.attributes, [
			{ name: 'bar', text: '+bar: Bar', type: 'Bar' }
		])
		assert.deepStrictEqual(foo?.methods, [
			{ name: 'callBar', text: '+callBar()' }
		])
		const bar = parsed.classes.find((entry) => entry.name === 'Bar')
		assert.ok(bar)
		assert.deepStrictEqual(bar?.methods, [
			{ name: 'doSomething', text: '+doSomething()' }
		])
		assert.deepStrictEqual(parsed.relations, [
			{ from: 'Foo', to: 'Bar', type: 'extends', label: undefined },
			{ from: 'Foo', to: 'Bar', type: 'calls', label: 'calls' }
		])
	})
})
