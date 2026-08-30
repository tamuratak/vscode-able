import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { nextRunInSandboxMode, resolveRunAction } from '../../../../src/lmtools/runinsandboxlib/mode.js'

suite('runinsandbox mode', () => {
	test('resolveRunAction maps mode and permission to an action', () => {
		const modes = ['on', 'skip', 'allow'] as const
		const table = modes.flatMap(mode => [true, false].map(isAllowed => ({
			mode,
			isAllowed,
			action: resolveRunAction(mode, isAllowed)
		})))
		assert.deepStrictEqual(table, [
			{ mode: 'on', isAllowed: true, action: 'sandbox' },
			{ mode: 'on', isAllowed: false, action: 'sandbox-confirm' },
			{ mode: 'skip', isAllowed: true, action: 'sandbox' },
			{ mode: 'skip', isAllowed: false, action: 'skip' },
			{ mode: 'allow', isAllowed: true, action: 'sandbox' },
			{ mode: 'allow', isAllowed: false, action: 'sandbox-auto' }
		])
	})

	test('nextRunInSandboxMode cycles on -> skip -> allow -> on', () => {
		const visited = [nextRunInSandboxMode('on'), nextRunInSandboxMode('skip'), nextRunInSandboxMode('allow')]
		assert.deepStrictEqual(visited, ['skip', 'allow', 'on'])
	})
})
