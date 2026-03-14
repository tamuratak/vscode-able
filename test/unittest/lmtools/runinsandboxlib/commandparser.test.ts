import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { hasNoWriteRedirection, normalizeToken, collectCommands, findScripts } from '../../../../src/lmtools/runinsandboxlib/commandparser.js'

suite('tree-sitter command parser', () => {
	test('detects truncate redirection', async () => {
		const result = await hasNoWriteRedirection('echo hi > output.txt')
		assert.strictEqual(result, false)
	})

	test('detects append redirection', async () => {
		const result = await hasNoWriteRedirection('printf hello >> logs.txt')
		assert.strictEqual(result, false)
	})

	test('detects descriptor-prefixed redirection', async () => {
		const result = await hasNoWriteRedirection('echo hi 2> errors.txt')
		assert.strictEqual(result, false)
	})

	test('ignores input redirection', async () => {
		const result = await hasNoWriteRedirection('cat < input.txt')
		assert.strictEqual(result, true)
	})

	test('returns false when no redirection operators are present', async () => {
		const result = await hasNoWriteRedirection('echo hello world')
		assert.strictEqual(result, true)
	})
})

suite('normalizeToken', () => {
	test('returns same for unquoted token', () => {
		const result = normalizeToken('hello')
		assert.strictEqual(result, 'hello')
	})

	test('strips double quotes', () => {
		const result = normalizeToken('"hello"')
		assert.strictEqual(result, 'hello')
	})

	test('strips single quotes', () => {
		const result = normalizeToken("'hello'")
		assert.strictEqual(result, 'hello')
	})

	test('unescapes escaped double quote inside double quotes', () => {
		const result = normalizeToken('"he\\"llo"')
		assert.strictEqual(result, 'he"llo')
	})

	test('unescapes escaped single quote', () => {
		const result = normalizeToken('it\\\'s')
		assert.strictEqual(result, 'it\'s')
	})

	test('unescapes escaped space', () => {
		const result = normalizeToken('a\\ b')
		assert.strictEqual(result, 'a b')
	})

	test('removes backslash-newline sequences', () => {
		const result = normalizeToken('first\\\nsecond')
		assert.strictEqual(result, 'firstsecond')
	})

	test('unescapes double backslash to single backslash', () => {
		const result = normalizeToken('\\\\')
		assert.strictEqual(result, '\\')
	})
})

suite('collectCommands', () => {
	test('parses simple command and arg', async () => {
 		const cmds = await collectCommands('echo hi')
 		assert.ok(cmds)
 		assert.strictEqual(cmds.length, 1)
 		assert.strictEqual(cmds[0].command, 'echo')
 		assert.deepStrictEqual(cmds[0].args, ['hi'])
 	})

	test('parses quoted arguments', async () => {
 		const cmds = await collectCommands('printf "%s\\n" "hello world"')
 		assert.ok(cmds)
 		assert.strictEqual(cmds.length, 1)
 		assert.strictEqual(cmds[0].command, 'printf')
 		assert.deepStrictEqual(cmds[0].args, ['%s\\n', 'hello world'])
 	})

	test('parses multiple commands', async () => {
 		const cmds = await collectCommands('cd /tmp\nls -la')
 		assert.ok(cmds)
 		assert.strictEqual(cmds.length, 2)
 		assert.strictEqual(cmds[0].command, 'cd')
 		assert.deepStrictEqual(cmds[0].args, ['/tmp'])
 		assert.strictEqual(cmds[1].command, 'ls')
 		assert.deepStrictEqual(cmds[1].args, ['-la'])
 	})
})

suite('findScripts', () => {
	test('finds python inline script from -c argument', async () => {
		const scripts = await findScripts("python -c 'print(1)'")
		assert.deepStrictEqual(scripts, [{ code: 'print(1)', kind: 'python' }])
	})

	test('finds javascript inline script from --eval argument', async () => {
		const scripts = await findScripts('node --eval "console.log(1)"')
		assert.deepStrictEqual(scripts, [{ code: 'console.log(1)', kind: 'javascript' }])
	})

	test('finds bash inline script from -c argument', async () => {
		const scripts = await findScripts("bash -c 'echo hello'")
		assert.deepStrictEqual(scripts, [{ code: 'echo hello', kind: 'bash' }])
	})

	test('finds heredoc script body', async () => {
		const scripts = await findScripts('python <<\'PY\'\nprint(\'x\')\nPY\n')
		assert.deepStrictEqual(scripts, [{ code: 'print(\'x\')\n', kind: 'python' }])
	})

	test('finds multiple scripts in one source', async () => {
		const source = [
			'python -c \'print(1)\'',
			'node -e "console.log(2)"',
			'bash <<\'EOF\'',
			'echo done',
			'EOF'
		].join('\n')

		const scripts = await findScripts(source)
		assert.deepStrictEqual(scripts, [
			{ code: 'print(1)', kind: 'python' },
			{ code: 'console.log(2)', kind: 'javascript' },
			{ code: 'echo done\n', kind: 'bash' }
		])
	})

	test('ignores non-script commands', async () => {
		const scripts = await findScripts('echo hi\nls -la')
		assert.deepStrictEqual(scripts, [])
	})
})
