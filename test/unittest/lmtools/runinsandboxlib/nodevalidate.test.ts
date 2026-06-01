import * as assert from 'node:assert'
import { suite, test } from 'mocha'
import { validateNodeScript } from '../../../../src/lmtools/runinsandboxlib/nodevalidate.js'

suite('validateNodeScript', () => {
    test('rejects require("fs")', async () => {
        const result = await validateNodeScript('const fs = require("fs")')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('require'))
    })

    test('rejects import from fs', async () => {
        const result = await validateNodeScript('import fs from "fs"')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('import'))
    })

    test('rejects variable assignment from require("child_process")', async () => {
        const result = await validateNodeScript('const cp = require("child_process"); cp.spawn("ls")')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('child_process'))
    })

    test('rejects destructuring from require("fs")', async () => {
        const result = await validateNodeScript('const { readFile } = require("fs"); readFile("/etc/passwd")')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('fs'))
    })

    test('rejects eval call', async () => {
        const result = await validateNodeScript('eval("1+1")')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('eval'))
    })

    test('rejects new Function() call', async () => {
        const result = await validateNodeScript("new Function('return 1')")
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('Function'))
    })

    test('rejects process reference', async () => {
        const result = await validateNodeScript('process.exit(0)')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('process'))
    })

    test('rejects globalThis reference', async () => {
        const result = await validateNodeScript('globalThis.require("fs")')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('globalThis'))
    })

    test('allows safe code with console.log', async () => {
        const result = await validateNodeScript('console.log("hello")')
        assert.strictEqual(result.ok, true)
    })

    test('allows safe code with Math operations', async () => {
        const result = await validateNodeScript('const x = Math.floor(Math.random() * 10)')
        assert.strictEqual(result.ok, true)
    })

    test('rejects require("net")', async () => {
        const result = await validateNodeScript('const net = require("net")')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('net'))
    })

    test('rejects require("http")', async () => {
        const result = await validateNodeScript('const http = require("http")')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('http'))
    })

    test('rejects require("vm")', async () => {
        const result = await validateNodeScript('const vm = require("vm")')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('vm'))
    })

    test('rejects global reference', async () => {
        const result = await validateNodeScript('global.process.exit(0)')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('global'))
    })

    test('handles empty code', async () => {
        const result = await validateNodeScript('')
        assert.strictEqual(result.ok, false)
        assert.strictEqual(result.reason, 'code is empty')
    })

    test('handles syntax error', async () => {
        const result = await validateNodeScript('const x = {')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('syntax error'))
    })

    test('allows array methods', async () => {
        const result = await validateNodeScript('const arr = [1, 2, 3]; arr.map(x => x * 2)')
        assert.strictEqual(result.ok, true)
    })

    test('allows string operations', async () => {
        const result = await validateNodeScript('const s = "hello world"; s.split(" ").length')
        assert.strictEqual(result.ok, true)
    })

    test('rejects dynamic import of fs', async () => {
        const result = await validateNodeScript('import("fs")')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('import'))
    })

    test('rejects dynamic import with non-literal argument', async () => {
        const result = await validateNodeScript('const m = "fs"; import(m)')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('non-literal'))
    })

    test('allows dynamic import of safe module', async () => {
        const result = await validateNodeScript('import("path")')
        assert.strictEqual(result.ok, true)
    })

    test('rejects require("node:fs")', async () => {
        const result = await validateNodeScript('const fs = require("node:fs")')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('fs'))
    })

    test('rejects import from "node:child_process"', async () => {
        const result = await validateNodeScript('import cp from "node:child_process"')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('child_process'))
    })

    test('rejects dynamic import("node:fs")', async () => {
        const result = await validateNodeScript('import("node:fs")')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('fs'))
    })

    test('rejects process["env"] bracket access', async () => {
        const result = await validateNodeScript('process["env"]')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('process'))
    })

    test('rejects process?.exit optional chaining', async () => {
        const result = await validateNodeScript('process?.exit(0)')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('process'))
    })

    test('rejects aliased destructuring from require("fs")', async () => {
        const result = await validateNodeScript('const { readFile: rf } = require("fs"); rf("/etc/passwd")')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('fs'))
    })

    test('rejects variable assignment from require("node:child_process")', async () => {
        const result = await validateNodeScript('const cp = require("node:child_process"); cp.spawn("ls")')
        assert.strictEqual(result.ok, false)
        assert.ok(result.reason?.includes('child_process'))
    })

    test('allows require("path")', async () => {
        const result = await validateNodeScript('const path = require("path")')
        assert.strictEqual(result.ok, true)
    })

    test('allows require("node:path")', async () => {
        const result = await validateNodeScript('const path = require("node:path")')
        assert.strictEqual(result.ok, true)
    })
})
