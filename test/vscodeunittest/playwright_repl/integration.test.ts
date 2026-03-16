import { ok, strictEqual, rejects } from 'node:assert'
import * as vscode from 'vscode'
import { PlaywrightReplResetTool, PlaywrightReplTool } from '../../../src/playwright_repl/playwrightrepltool.js'

const extensionId = 'tamuratak.able'
const baseUrl = 'http://127.0.0.1:3000'

type ConfigKey =
    | 'browserType'
    | 'headless'
    | 'network.allow'
    | 'network.allowedHosts'
    | 'timeoutMs'
    | 'maxOutputBytes'
    | 'maxScreenshotBytes'
    | 'screenshotDefaultFormat'

type ConfigValue = string | boolean | number | string[] | undefined

suite('Playwright REPL Integration Test', () => {
    let outputChannel: vscode.LogOutputChannel
    let tool: PlaywrightReplTool
    let resetTool: PlaywrightReplResetTool
    let tokenSource: vscode.CancellationTokenSource
    const configTarget = vscode.ConfigurationTarget.Global
    const previousConfig = new Map<ConfigKey, ConfigValue>()

    suiteSetup(async () => {
        const extension = vscode.extensions.getExtension(extensionId)
        ok(extension)
        await extension.activate()

        const conf = vscode.workspace.getConfiguration('able.playwrightRepl')
        const keys: ConfigKey[] = [
            'browserType',
            'headless',
            'network.allow',
            'network.allowedHosts',
            'timeoutMs',
            'maxOutputBytes',
            'maxScreenshotBytes',
            'screenshotDefaultFormat'
        ]
        for (const key of keys) {
            previousConfig.set(key, conf.get<ConfigValue>(key))
        }

        await conf.update('browserType', 'chromium', configTarget)
        await conf.update('headless', true, configTarget)
        await conf.update('network.allow', false, configTarget)
        await conf.update('network.allowedHosts', [], configTarget)
        await conf.update('timeoutMs', 15000, configTarget)
        await conf.update('maxOutputBytes', 16384, configTarget)
        await conf.update('maxScreenshotBytes', 1024 * 1024, configTarget)
        await conf.update('screenshotDefaultFormat', 'jpeg', configTarget)

        outputChannel = vscode.window.createOutputChannel('playwright repl integration', { log: true })
        tokenSource = new vscode.CancellationTokenSource()
        tool = new PlaywrightReplTool({
            outputChannel,
            extensionUri: extension.extensionUri
        })
        resetTool = new PlaywrightReplResetTool(tool)
    })

    setup(() => {
        ok(resetTool)
        resetTool.invoke({ toolInvocationToken: undefined, input: { reason: 'test setup reset' } }, tokenSource.token)
    })

    suiteTeardown(async () => {
        if (tool) {
            tool.dispose()
        }
        if (tokenSource) {
            tokenSource.dispose()
        }
        if (outputChannel) {
            outputChannel.dispose()
        }

        const conf = vscode.workspace.getConfiguration('able.playwrightRepl')
        for (const [key, value] of previousConfig) {
            await conf.update(key, value, configTarget)
        }
    })

    test('prepareInvocation returns message for repl tool', () => {
        const prepared = tool.prepareInvocation({ input: { code: '1 + 1' } })
        strictEqual(prepared.invocationMessage, 'Execute JavaScript with persistent Playwright session')
    })

    test('prepareInvocation returns message for reset tool', () => {
        const prepared = resetTool.prepareInvocation({ input: { reason: 'unit' } })
        strictEqual(prepared.invocationMessage, 'Reset persistent Playwright session')
    })

    test('rejects empty code', async () => {
        await rejects(
            () => invokeCode('   '),
            /code is empty/
        )
    })

    test('executes simple expression', async () => {
        const result = await invokeCode('return 1 + 2')
        const text = extractText(result)
        ok(text.includes('result:\n3'))
    })

    test('supports top level await', async () => {
        const result = await invokeCode('return await Promise.resolve(7)')
        const text = extractText(result)
        ok(text.includes('result:\n7'))
    })

    test('captures stdout and stderr', async () => {
        const result = await invokeCode("console.log('hello'); console.error('warn'); return 'done'")
        const text = extractText(result)
        ok(text.includes('stdout:\nhello'))
        ok(text.includes('stderr:\nwarn'))
        ok(text.includes('result:\ndone'))
    })

    test('navigates to local page and reads text', async () => {
        const result = await invokeCode(`
await pw.goto('${baseUrl}')
return await pw.text('#title')
`)
        const text = extractText(result)
        ok(text.includes('result:\nReady'))
    })

    test('fills and clicks using helper api', async () => {
        const result = await invokeCode(`
await pw.goto('${baseUrl}')
await pw.fill('#name', 'Updated by Test')
await pw.click('#apply')
return await pw.text('#title')
`)
        const text = extractText(result)
        ok(text.includes('result:\nUpdated by Test'))
    })

    test('screenshot returns image data part', async () => {
        const result = await invokeCode(`
await pw.goto('${baseUrl}')
await pw.screenshot({ format: 'png' })
return 'shot'
`)
        const text = extractText(result)
        ok(text.includes('result:\nshot'))

        const imageParts = result.content.filter(part => part instanceof vscode.LanguageModelDataPart)
        strictEqual(imageParts.length, 1)

        const imagePart = imageParts[0]
        if (!(imagePart instanceof vscode.LanguageModelDataPart)) {
            throw new Error('expected LanguageModelDataPart')
        }
        strictEqual(imagePart.mimeType, 'image/png')
        ok(imagePart.data.byteLength > 0)
    })

    test('keeps session state between invocations', async () => {
        await invokeCode(`
await pw.goto('${baseUrl}')
return await pw.url()
`)
        const result = await invokeCode('return await pw.url()')
        const text = extractText(result)
        ok(text.includes(`result:\n${baseUrl}/`))
    })

    test('reset tool clears session state', async () => {
        await invokeCode(`
await pw.goto('${baseUrl}')
return await pw.url()
`)
        resetTool.invoke({ toolInvocationToken: undefined, input: { reason: 'state reset' } }, tokenSource.token)

        const result = await invokeCode('return await pw.url()')
        const text = extractText(result)
        ok(text.includes('result:\nabout:blank'))
    })

    test('blocks external network by default', async () => {
        await rejects(
            () => invokeCode("await pw.goto('https://example.com')"),
            /validation failed|blockedbyclient|ERR|Navigation/
        )
    })

    async function invokeCode(code: string): Promise<vscode.LanguageModelToolResult> {
        const result = await Promise.resolve(tool.invoke({
            toolInvocationToken: undefined,
            input: { code }
        }, tokenSource.token))
        return result
    }

    function extractText(result: vscode.LanguageModelToolResult): string {
        let value = ''
        for (const part of result.content) {
            if (part instanceof vscode.LanguageModelTextPart) {
                value += part.value
            }
        }
        return value
    }
})
