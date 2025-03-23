import { suite, test } from 'mocha'
import assert from 'node:assert'
import { readFile } from 'node:fs/promises'
import { type MochaJsonResult } from '../../../src/tasklib/mocha.js'
import { collectMochaJsonFailures, removeBeforeFirstBrace } from '../../../src/tasklib/mochalib/mochajson.js'


suite('MochaTask test', () => {
    test('parse mocha json output', async () => {
        const buff = await readFile('test/fixtures/mochajson01/m.json')
        const decoder = new TextDecoder()
        const jsonStringWithGarbage = decoder.decode(buff)
        const json = removeBeforeFirstBrace(jsonStringWithGarbage)
        const jsonObj = JSON.parse(json) as MochaJsonResult
        assert(jsonObj.stats.duration > 0)
    })

    test('should collect failures', async () => {
        const buff = await readFile('test/fixtures/mochajson01/m.json')
        const decoder = new TextDecoder()
        const jsonStringWithGarbage = decoder.decode(buff)
        const failures = collectMochaJsonFailures(jsonStringWithGarbage)
        assert(failures.length > 0)
    })
})
