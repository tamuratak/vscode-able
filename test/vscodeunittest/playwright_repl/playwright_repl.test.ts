import { match, ok, strictEqual } from 'node:assert'
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

suite('Playwright Repl VS Code Integration Test', () => {
    setup(async () => {
        await invokeReset()
    })

    test('able_playwrightrepl_exec basic success', async () => {
        const result = await invokeExec('1 + 1')
        const rendered = await renderToolResult(result)
        match(rendered, /ok: true/)
        match(rendered, /value: 2/)
    })

    test('state is preserved across exec calls', async () => {
        const targetUrl = 'data:text/html,<title>persisted</title><h1>persisted</h1>'
        await invokeExec(`await pw.page.goto(${JSON.stringify(targetUrl)})`)

        const result = await invokeExec('await pw.page.title()')
        const rendered = await renderToolResult(result)
        match(rendered, /ok: true/)
        match(rendered, /value: persisted/)
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
            "await pw.page.setContent('<html><body><h1>shot</h1></body></html>')",
            "await pw.page.screenshot('png')",
            "'shot-done'"
        ].join('\n'))
        const rendered = await renderToolResult(result)

        let imagePartCount = 0
        for (const part of result.content) {
            if (part instanceof vscode.LanguageModelDataPart && part.mimeType === 'image/png') {
                imagePartCount += 1
            }
        }

        strictEqual(imagePartCount, 1)
        match(rendered, /screenshots: 1/)
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
        match(rendered, /message: boom-from-test/)
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
