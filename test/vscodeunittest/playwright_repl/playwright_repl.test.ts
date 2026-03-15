import { match, ok, strictEqual } from 'node:assert'
import { ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { renderToolResult } from '../../../src/utils/toolresultrendering.js'

interface PlaywrightReplExecInput {
    code: string
    explanation: string
}

interface PlaywrightReplResetInput {
    reason: string
}

async function invokeExec(code: string) {
    const input: PlaywrightReplExecInput = {
        code,
        explanation: 'integration test',
    }
    return vscode.lm.invokeTool('able_playwrightrepl_exec', {
        toolInvocationToken: undefined,
        input
    })
}

async function invokeReset() {
    const input: PlaywrightReplResetInput = {
        reason: 'integration test reset',
    }
    return vscode.lm.invokeTool('able_playwrightrepl_reset', {
        toolInvocationToken: undefined,
        input
    })
}

const testServerUrl = 'http://127.0.0.1:4173'
let testServerProcess: ChildProcessWithoutNullStreams | undefined

async function waitForServerReady(url: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
        try {
            const response = await fetch(url)
            if (response.ok) {
                return
            }
        } catch {
            // ignore and retry until timeout
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 100))
    }

    throw new Error(`test server was not ready within ${String(timeoutMs)}ms`)
}

async function startTestServer(): Promise<void> {
    if (testServerProcess) {
        return
    }

    const scriptPath = path.resolve(__dirname, '../../../../dev/playwright_repl_test/server.cjs')
    testServerProcess = spawn(process.execPath, [scriptPath], {
        stdio: 'pipe',
    })

    await waitForServerReady(`${testServerUrl}/health`, 7000)
}

async function stopTestServer(): Promise<void> {
    const current = testServerProcess
    if (!current) {
        return
    }

    await new Promise<void>((resolve) => {
        current.once('exit', () => resolve())
        current.kill('SIGTERM')
    })

    testServerProcess = undefined
}

suite('Playwright Repl VS Code Integration Test', () => {
    suiteSetup(async () => {
        await startTestServer()
    })

    suiteTeardown(async () => {
        await stopTestServer()
    })

    setup(async () => {
        await invokeReset()
    })

    test('able_playwrightrepl_exec basic success', async () => {
        const result = await invokeExec('1 + 1')
        const rendered = await renderToolResult(result)
        match(rendered, /ok: true/)
        match(rendered, /value: undefined/)
    })

    test('state is preserved across exec calls', async () => {
        const targetUrl = 'data:text/html,<title>persisted</title><h1>persisted</h1>'
        await invokeExec(`await pw.page.goto(${JSON.stringify(targetUrl)})`)

        const result = await invokeExec([
            'const title = await pw.page.title()',
            'if (title !== \'persisted\') {',
            '  throw new Error(`title mismatch: ${title}`)',
            '}',
        ].join('\n'))
        const rendered = await renderToolResult(result)
        match(rendered, /ok: true/)
        match(rendered, /value: undefined/)
    })

    test('able_playwrightrepl_reset clears browser state', async () => {
        const targetUrl = 'data:text/html,<title>reset-target</title><h1>reset-target</h1>'
        await invokeExec(`await pw.page.goto(${JSON.stringify(targetUrl)})`)
        await invokeReset()

        const result = await invokeExec('await pw.page.url()')
        const rendered = await renderToolResult(result)
        match(rendered, /ok: true/)
        ok(!rendered.includes('reset-target'))
    })

    test('screenshot is returned as data part', async () => {
        const result = await invokeExec([
            "await pw.page.goto('data:text/html,<html><body><h1>shot</h1></body></html>')",
            "await pw.page.screenshot('png')",
            "'shot-done'"
        ].join('\n'))
        const rendered = await renderToolResult(result)
        ok(result.content.length >= 1)
        match(rendered, /screenshots: 1/)
    })

    test('can navigate to local test server page', async () => {
        const result = await invokeExec([
            `await pw.page.goto('${testServerUrl}/')`,
            "const heading = await pw.page.textcontent('h1')",
            "if (heading !== 'Playwright Test Page') {",
            '  throw new Error(`unexpected heading: ${heading}`)',
            '}',
        ].join('\n'))

        const rendered = await renderToolResult(result)
        match(rendered, /ok: true/)
    })

    test('syntax guard rejection returns structured message', async () => {
        const result = await invokeExec("import fs from 'node:fs'\n1")
        const rendered = await renderToolResult(result)
        match(rendered, /blocked by syntax guard/)
        match(rendered, /rule_id:/)
        match(rendered, /node_type:/)
        match(rendered, /line:/)
        match(rendered, /column:/)
        match(rendered, /message:/)
    })

    test('runtime error is classified as playwright_runtime', async () => {
        const result = await invokeExec("throw new Error('boom-from-test')")
        const rendered = await renderToolResult(result)
        match(rendered, /error_class: playwright_runtime/)
        match(rendered, /message: Error: boom-from-test/)
    })

    test('able_playwrightrepl_reset returns success message', async () => {
        const result = await invokeReset()
        const rendered = await renderToolResult(result)
        strictEqual(rendered, 'playwright repl was reset')
    })

    test('unsupported screenshot format is classified as playwright_runtime', async () => {
        const result = await invokeExec("await pw.page.screenshot('gif')")
        const rendered = await renderToolResult(result)
        match(rendered, /error_class: playwright_runtime/)
        match(rendered, /supports only png and jpeg/)
    })
})
