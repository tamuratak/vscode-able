import { ok, strictEqual, rejects } from 'node:assert'
import * as http from 'node:http'
import * as vscode from 'vscode'
import { PlaywrightReplResetTool, PlaywrightReplTool } from '../../../src/playwright_repl/playwrightrepltool.js'

const extensionId = 'tamuratak.able'

type ConfigKey =
    | 'browserType'
    | 'headless'

type ConfigValue = string | boolean | number | string[] | undefined

const minAllowedPort = 3000
const maxAllowedPort = 3010

async function listenServerInAllowedRange(server: http.Server): Promise<number> {
    for (let port = minAllowedPort; port <= maxAllowedPort; port += 1) {
        const bound = await tryListen(server, port)
        if (bound) {
            return port
        }
    }

    throw new Error('failed to bind test server in allowed port range')
}

function tryListen(server: http.Server, port: number): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
        const onListening = () => {
            server.off('error', onError)
            resolve(true)
        }

        const onError = (error: NodeJS.ErrnoException) => {
            server.off('listening', onListening)
            if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
                resolve(false)
                return
            }
            reject(error)
        }

        server.once('listening', onListening)
        server.once('error', onError)
        server.listen(port, '127.0.0.1')
    })
}

suite('Playwright REPL Integration Test', () => {
    let server: http.Server
    let baseUrl = ''
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
            'headless'
        ]
        for (const key of keys) {
            previousConfig.set(key, conf.get<ConfigValue>(key))
        }

        await conf.update('browserType', 'chromium', configTarget)
        await conf.update('headless', true, configTarget)

        server = http.createServer((request, response) => {
            if (!request.url || request.url === '/') {
                response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
                response.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>playwright repl integration</title></head>
<body>
    <h1 id="title">Ready</h1>
    <label for="name">Name</label>
    <input id="name" />
    <button id="apply" type="button">Apply</button>
    <script>
        const button = document.getElementById('apply')
        button.addEventListener('click', () => {
            const input = document.getElementById('name')
            const title = document.getElementById('title')
            title.textContent = input.value || 'Ready'
        })
    </script>
</body>
</html>`)
                return
            }

            response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
            response.end('not found')
        })

        const boundPort = await listenServerInAllowedRange(server)
        baseUrl = `http://127.0.0.1:${boundPort}`

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
        if (server) {
            await new Promise<void>((resolve, rejectError) => {
                server.close((error) => {
                    if (error) {
                        rejectError(error)
                        return
                    }
                    resolve()
                })
            })
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
await pwApi.page.goto('${baseUrl}')
return await pwApi.page.textContent('#title')
`)
        const text = extractText(result)
        ok(text.includes('result:\nReady'))
    })

    test('fills and clicks using page api', async () => {
        const result = await invokeCode(`
await pwApi.page.goto('${baseUrl}')
await pwApi.page.fill('#name', 'Updated by Test')
await pwApi.page.click('#apply')
return await pwApi.page.textContent('#title')
`)
        const text = extractText(result)
        ok(text.includes('result:\nUpdated by Test'))
    })

    test('screenshot returns image data part', async () => {
        const result = await invokeCode(`
await pwApi.page.goto('${baseUrl}')
await pwApi.screenshot({ format: 'png' })
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
await pwApi.page.goto('${baseUrl}')
return pwApi.page.url()
`)
        const result = await invokeCode('return pwApi.page.url()')
        const text = extractText(result)
        ok(text.includes(`result:\n${baseUrl}/`))
    })

    test('reset tool clears session state', async () => {
        await invokeCode(`
await pwApi.page.goto('${baseUrl}')
return pwApi.page.url()
`)
        resetTool.invoke({ toolInvocationToken: undefined, input: { reason: 'state reset' } }, tokenSource.token)

        const result = await invokeCode('return pwApi.page.url()')
        const text = extractText(result)
        ok(text.includes('result:\nabout:blank'))
    })

    test('blocks external network by default', async () => {
        await rejects(
            () => invokeCode("await pwApi.page.goto('https://example.com')"),
            /validation failed|blockedbyclient|ERR|Navigation/
        )
    })

    test('removed helper api is not available', async () => {
        await rejects(
            () => invokeCode(`
await pwApi.page.goto('${baseUrl}')
return await pwApi.fill('#name', 'x')
`),
            /pwApi\.fill is not a function/
        )
    })

    test('evaluate supports function object', async () => {
        const result = await invokeCode(`
await pwApi.page.goto('${baseUrl}')
return await pwApi.page.evaluate(() => document.title)
`)
        const text = extractText(result)
        ok(text.includes('result:\nplaywright repl integration'))
    })

    test('evaluate supports function object with arg', async () => {
        const result = await invokeCode(`
return await pwApi.page.evaluate((arg) => arg + 1, 10)
`)
        const text = extractText(result)
        ok(text.includes('result:\n11'))
    })

    test('evaluate with arg', async () => {
        const result = await invokeCode(`
await pwApi.page.goto('${baseUrl}')
return await pwApi.page.evaluate((arg) => document.title + '-' + arg, 'ok')
`)
        const text = extractText(result)
        ok(text.includes('result:\nplaywright repl integration-ok'))
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
