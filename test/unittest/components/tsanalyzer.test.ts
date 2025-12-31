import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { buildMermaidDiagramFromContent, parseDescriptionMentions } from '../../../src/components/tsanalyzer.js'

suite('ts analyzer description mentions', () => {
	test('extracts classes methods and properties from text', () => {
		const description = 'クラス `Foo` は property `Foo.bar` を持ち、method `Foo#callOther` から `Bar#doSomething` を呼び出す'
		const mentions = parseDescriptionMentions(description)
		assert.ok(mentions.classes.has('Foo'))
		assert.ok(mentions.classes.has('Bar'))
		assert.ok(mentions.properties.get('Foo')?.has('bar'))
		assert.ok(mentions.methods.get('Foo')?.has('callOther'))
		assert.ok(mentions.methods.get('Bar')?.has('doSomething'))
	})
})

suite('ts analyzer mermaid generation', () => {
	test('builds diagram limited to described elements', async () => {
		const source = `class Foo extends Base {
			bar: Bar
			callOther() {
				Bar.doSomething()
			}
		}
		class Base {}
		class Bar {
			doSomething() {}
		}`
		const description = 'クラス `Foo` は `Base` を継承し、property `Foo.bar` で `Bar` を保持する。method `Foo#callOther` から `Bar#doSomething` を呼び出す。'
		const diagram = await buildMermaidDiagramFromContent(source, description)
		const expected = `classDiagram
	class Base
	class Bar {
		+doSomething()
	}
	class Foo {
		+bar: Bar
		+callOther()
	}
	Base <|-- Foo
	Foo --> Bar : bar
	Foo ..> Bar : calls doSomething()
`
		assert.strictEqual(diagram, expected)
	})
})
