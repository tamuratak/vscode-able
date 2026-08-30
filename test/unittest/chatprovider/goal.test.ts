import { strict as assert } from 'node:assert'
import { suite, test } from 'mocha'
import {
    buildGoalCommandResponse,
    buildGoalSteeringText,
    deriveGoalState,
    extractGoalCommand,
    GOAL_BLOCKED_MARKER,
    GOAL_COMPLETE_MARKER,
    makeGoalMarker,
    parseGoalCommand,
    type GoalCommand,
    type GoalMessage,
    type GoalState,
} from '../../../src/chatprovider/opencodegochatprovider/goal.js'

function message(role: GoalMessage['role'], text: string): GoalMessage {
    return { role, text }
}

suite('goal.parseGoalCommand', () => {
    test('bare /goal shows the goal', () => {
        assert.deepStrictEqual(parseGoalCommand('/goal'), { action: 'show' })
    })

    test('sets the objective from the rest of the line', () => {
        assert.deepStrictEqual(parseGoalCommand('/goal fix the login bug'), { action: 'set', objective: 'fix the login bug' })
    })

    test('clear and resume subcommands', () => {
        assert.deepStrictEqual(parseGoalCommand('/goal clear'), { action: 'clear' })
        assert.deepStrictEqual(parseGoalCommand('/goal resume'), { action: 'resume' })
    })

    test('status is an alias of show', () => {
        assert.deepStrictEqual(parseGoalCommand('/goal status'), { action: 'show' })
    })

    test('trailing whitespace is ignored', () => {
        assert.deepStrictEqual(parseGoalCommand('/goal   '), { action: 'show' })
    })

    test('mid-line mentions are ignored', () => {
        assert.strictEqual(parseGoalCommand('please run /goal for me'), undefined)
    })

    test('indented lines are ignored', () => {
        assert.strictEqual(parseGoalCommand('  /goal fix the bug'), undefined)
    })

    test('the last command line wins', () => {
        const text = '/goal first objective\nsome note\n/goal second objective'
        assert.deepStrictEqual(parseGoalCommand(text), { action: 'set', objective: 'second objective' })
    })

    test('CRLF line endings are tolerated', () => {
        assert.deepStrictEqual(parseGoalCommand('/goal fix the login bug\r\n'), { action: 'set', objective: 'fix the login bug' })
    })
})

suite('goal.makeGoalMarker and deriveGoalState', () => {
    test('a set marker makes the goal active with zero turns', () => {
        const setMarker = makeGoalMarker('set', 'fix the login bug')
        const state = deriveGoalState([message('assistant', `Goal set.\n\n${setMarker}`)])
        assert.deepStrictEqual(state, { kind: 'active', objective: 'fix the login bug', turnsUsed: 0 })
    })

    test('assistant messages after the set marker count as turns', () => {
        const setMarker = makeGoalMarker('set', 'fix the login bug')
        const state = deriveGoalState([
            message('user', '/goal fix the login bug'),
            message('assistant', `Goal set.\n\n${setMarker}`),
            message('user', 'Please continue and complete the active goal.'),
            message('assistant', 'Working on it.'),
        ])
        assert.deepStrictEqual(state, { kind: 'active', objective: 'fix the login bug', turnsUsed: 1 })
    })

    test('the objective survives round-trip encoding with special characters', () => {
        const objective = 'fix -- the <login> bug\n日本語の目標 with <!-- comments --> and "quotes"'
        const state = deriveGoalState([message('assistant', makeGoalMarker('set', objective))])
        assert.deepStrictEqual(state, { kind: 'active', objective, turnsUsed: 0 })
    })

    test('a clear marker removes the goal', () => {
        const state = deriveGoalState([
            message('assistant', makeGoalMarker('set', 'fix the login bug')),
            message('assistant', `Goal cleared.\n${makeGoalMarker('clear')}`),
        ])
        assert.deepStrictEqual(state, { kind: 'none' })
    })

    test('the complete marker ends the goal', () => {
        const state = deriveGoalState([
            message('assistant', makeGoalMarker('set', 'fix the login bug')),
            message('assistant', `All requirements verified.\n${GOAL_COMPLETE_MARKER}`),
        ])
        assert.deepStrictEqual(state, { kind: 'none' })
    })

    test('the blocked marker ends the goal', () => {
        const state = deriveGoalState([
            message('assistant', makeGoalMarker('set', 'fix the login bug')),
            message('assistant', `Blocked by missing credentials.\n${GOAL_BLOCKED_MARKER}`),
        ])
        assert.deepStrictEqual(state, { kind: 'none' })
    })

    test('a paused marker keeps the objective for later resume', () => {
        const state = deriveGoalState([
            message('assistant', makeGoalMarker('set', 'fix the login bug')),
            message('assistant', makeGoalMarker('paused')),
        ])
        assert.deepStrictEqual(state, { kind: 'paused', objective: 'fix the login bug' })
    })

    test('a new set marker after pause reactivates the goal', () => {
        const state = deriveGoalState([
            message('assistant', makeGoalMarker('set', 'first goal')),
            message('assistant', makeGoalMarker('paused')),
            message('assistant', `Goal resumed.\n${makeGoalMarker('set', 'first goal')}`),
        ])
        assert.deepStrictEqual(state, { kind: 'active', objective: 'first goal', turnsUsed: 0 })
    })

    test('markers in the system message are ignored', () => {
        const state = deriveGoalState([
            message('system', `instructions\n${GOAL_COMPLETE_MARKER}\n${makeGoalMarker('clear')}`),
            message('assistant', makeGoalMarker('set', 'fix the login bug')),
        ])
        assert.deepStrictEqual(state, { kind: 'active', objective: 'fix the login bug', turnsUsed: 0 })
    })

    test('a set marker with an undecodable payload is ignored', () => {
        const state = deriveGoalState([message('assistant', '<!-- ABLE_GOAL_SET_aabbccdd abc -->')])
        assert.deepStrictEqual(state, { kind: 'none' })
    })

    test('a paused marker without an active goal is ignored', () => {
        const state = deriveGoalState([message('assistant', makeGoalMarker('paused'))])
        assert.deepStrictEqual(state, { kind: 'none' })
    })
})

suite('goal.extractGoalCommand', () => {
    test('parses the command from the last user message', () => {
        const command = extractGoalCommand([
            message('system', 'You are...'),
            message('user', '<context>stuff</context>\n/goal fix the login bug'),
        ])
        assert.deepStrictEqual(command, { action: 'set', objective: 'fix the login bug' })
    })

    test('returns undefined when the last message is not a user message', () => {
        assert.strictEqual(extractGoalCommand([message('assistant', 'Done.')]), undefined)
    })

    test('returns undefined when the last user message has no command', () => {
        assert.strictEqual(extractGoalCommand([message('user', 'Please continue and complete the active goal.')]), undefined)
    })

    test('returns undefined for an empty message list', () => {
        assert.strictEqual(extractGoalCommand([]), undefined)
    })
})

suite('goal.buildGoalCommandResponse', () => {
    const active: GoalState = { kind: 'active', objective: 'fix the login bug', turnsUsed: 2 }
    const paused: GoalState = { kind: 'paused', objective: 'fix the login bug' }

    test('set returns the objective and a working set marker', () => {
        const command: GoalCommand = { action: 'set', objective: 'fix the login bug' }
        const response = buildGoalCommandResponse(command, { kind: 'none' })
        assert.ok(response.text.includes('<objective>\nfix the login bug\n</objective>'))
        if (response.marker === undefined) {
            assert.fail('set response must carry a marker')
        }
        assert.deepStrictEqual(
            deriveGoalState([message('assistant', response.marker)]),
            { kind: 'active', objective: 'fix the login bug', turnsUsed: 0 }
        )
    })

    test('show reports the active goal without changing state', () => {
        const response = buildGoalCommandResponse({ action: 'show' }, active)
        assert.ok(response.text.includes('fix the login bug'))
        assert.ok(response.text.includes('Automatic continuation turns used so far: 2.'))
        assert.strictEqual(response.marker, undefined)
    })

    test('show reports a paused goal', () => {
        const response = buildGoalCommandResponse({ action: 'show' }, paused)
        assert.ok(response.text.includes('paused'))
        assert.strictEqual(response.marker, undefined)
    })

    test('show without a goal explains how to set one', () => {
        const response = buildGoalCommandResponse({ action: 'show' }, { kind: 'none' })
        assert.ok(response.text.includes('/goal <objective>'))
        assert.strictEqual(response.marker, undefined)
    })

    test('clear emits a clear marker only when a goal exists', () => {
        const cleared = buildGoalCommandResponse({ action: 'clear' }, active)
        if (cleared.marker === undefined) {
            assert.fail('clear response must carry a marker')
        }
        assert.deepStrictEqual(
            deriveGoalState([
                message('assistant', makeGoalMarker('set', 'fix the login bug')),
                message('assistant', `Goal cleared.\n${cleared.marker}`),
            ]),
            { kind: 'none' }
        )
        const nothingToClear = buildGoalCommandResponse({ action: 'clear' }, { kind: 'none' })
        assert.strictEqual(nothingToClear.marker, undefined)
    })

    test('resume reactivates a paused goal through a fresh set marker', () => {
        const response = buildGoalCommandResponse({ action: 'resume' }, paused)
        if (response.marker === undefined) {
            assert.fail('resume response must carry a marker')
        }
        assert.deepStrictEqual(
            deriveGoalState([message('assistant', response.marker)]),
            { kind: 'active', objective: 'fix the login bug', turnsUsed: 0 }
        )
        assert.strictEqual(buildGoalCommandResponse({ action: 'resume' }, active).marker, undefined)
        assert.strictEqual(buildGoalCommandResponse({ action: 'resume' }, { kind: 'none' }).marker, undefined)
    })

    test('long objectives are truncated', () => {
        const response = buildGoalCommandResponse({ action: 'set', objective: 'x'.repeat(3000) }, { kind: 'none' })
        if (response.marker === undefined) {
            assert.fail('set response must carry a marker')
        }
        const state = deriveGoalState([message('assistant', response.marker)])
        if (state.kind !== 'active') {
            assert.fail('expected an active goal')
        }
        assert.ok(state.objective.length < 3000)
    })
})

suite('goal.buildGoalSteeringText', () => {
    test('contains the objective and the terminal markers', () => {
        const text = buildGoalSteeringText({ kind: 'active', objective: 'fix the login bug', turnsUsed: 0 })
        assert.ok(text.includes('<goal_context>'))
        assert.ok(text.includes('fix the login bug'))
        assert.ok(text.includes(GOAL_COMPLETE_MARKER))
        assert.ok(text.includes(GOAL_BLOCKED_MARKER))
        assert.ok(!text.includes('Automatic goal continuation turn'))
    })

    test('reports the continuation turn number after the first turn', () => {
        const text = buildGoalSteeringText({ kind: 'active', objective: 'fix the login bug', turnsUsed: 3 })
        assert.ok(text.includes('Automatic goal continuation turn: 4.'))
    })

    test('terminal markers are on their own lines', () => {
        const text = buildGoalSteeringText({ kind: 'active', objective: 'fix the login bug', turnsUsed: 0 })
        assert.ok(text.includes(`\n${GOAL_COMPLETE_MARKER}\n`))
        assert.ok(text.includes(`\n${GOAL_BLOCKED_MARKER}\n`))
    })
})
