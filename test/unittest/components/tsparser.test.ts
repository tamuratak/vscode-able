import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { collectImports, collectExportedSymbols } from '../../../src/components/tsparser.js'

suite('ts parser collectImports', () => {
	test('captures default and named bindings', async () => {
		const source = 'import fs, { readFile as rf, writeFile } from \'fs\''
		const imports = await collectImports(source)
		assert.ok(imports)
		assert.strictEqual(imports.length, 1)
		assert.deepStrictEqual(imports[0], {
			module: 'fs',
			defaultBinding: 'fs',
			namespaceImport: undefined,
			namedImports: [
				{ name: 'readFile', alias: 'rf' },
				{ name: 'writeFile', alias: undefined }
			]
		})
	})

	test('records namespace and side-effect imports', async () => {
		const source = `import * as path from 'path'
import 'setup'
`
		const imports = await collectImports(source)
		assert.ok(imports)
		assert.strictEqual(imports.length, 2)
		assert.deepStrictEqual(imports[0], {
			module: 'path',
			defaultBinding: undefined,
			namespaceImport: 'path',
			namedImports: []
		})
		assert.deepStrictEqual(imports[1], {
			module: 'setup',
			defaultBinding: undefined,
			namespaceImport: undefined,
			namedImports: []
		})
	})
})

suite('ts parser collectExportedSymbols', () => {
	test('enumerates top-level exports', async () => {
		const source = `export const first = 1, second = 2
export function greet() {}
export class Model {}
export interface Payload {}
export type Token = string
export enum Mode {}`
		const symbols = await collectExportedSymbols(source)
		assert.ok(symbols)
		assert.deepStrictEqual(symbols, [
			{ name: 'first', kind: 'const' },
			{ name: 'second', kind: 'const' },
			{ name: 'greet', kind: 'function' },
			{ name: 'Model', kind: 'class' },
			{ name: 'Payload', kind: 'interface' },
			{ name: 'Token', kind: 'type' },
			{ name: 'Mode', kind: 'enum' }
		])
	})
})
