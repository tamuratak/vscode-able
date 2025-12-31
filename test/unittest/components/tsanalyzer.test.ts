import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { generateFocusedMermaidDiagram } from '../../../src/components/tsanalyzer.js'

suite('ts analyzer', () => {
	test('filters described classes and relations', async () => {
		const markdown = `この文書は Foo が bar プロパティと callBar メソッドを持ち、Bar.doSomething を呼び出すことを説明します。

\`\`\`mermaid
classDiagram
class Foo {
	+bar: Bar
	+callBar()
}
class Bar {
	+doSomething()
}
Foo o-- Bar
\`\`\`
`
		const source = `export class Bar {
			doSomething() {}
		}

		export class Foo {
			bar: Bar
			callBar() {
				Bar.doSomething()
			}
		}
		`
		const diagram = await generateFocusedMermaidDiagram({
			markdown,
			sourceFiles: [{ path: 'src/foo.ts', content: source }]
		})
		const expected = `classDiagram
	class Bar {
		doSomething()
	}
	class Foo {
		bar: Bar
		callBar()
	}
	Foo ..> Bar : callBar -> doSomething
	Foo o-- Bar : bar`
		assert.strictEqual(diagram, expected)
	})

	test('returns undefined when no relevant mentions', async () => {
		const markdown = `この文章は対象のクラス名前を含んでいません。

\`\`\`mermaid
classDiagram
class Foo {
	+bar: Bar
}
\`\`\`
`
		const result = await generateFocusedMermaidDiagram({ markdown })
		assert.strictEqual(result, undefined)
	})
})
