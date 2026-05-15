import * as vscode from 'vscode'
import { ChatHandleManager } from './chat/chat.js'
import { registerCommands } from './commands.js'
import { MochaJsonTaskProvider } from './task/task.js'
import { TaskWatcher } from './task/taskwatcher.js'
import { GeminiApiKeyAuthenticationProvider, OpenCodeGoApiKeyAuthenticationProvider } from './auth/authproviders.js'
import { GeminiChatProvider, OpenCodeGoChatModelProvider } from './chatprovider/chatprovider.js'
import { WebSearchTool } from './lmtools/websearch.js'
import { RunInSandbox } from './lmtools/runinsandbox.js'
import { renderToolResult } from './utils/toolresultrendering.js'
import { FetchWebPageTool, FetchWebPageToolAutoApprove } from './lmtools/fetchwebpage.js'
import { GeminiCliChatProvider } from './chatprovider/geminicli/geminiclichatprovider.js'
import { AskChatHandleManager } from './chat/ask.js'
import { PlaywrightExecResetTool, PlaywrightExecTool } from './playwright_exec/playwrightexectool.js'
import { Lean4Extension } from './lean4.js'
import { MathRenderer } from './mathjax/mathrenderer.js'


class Extension {
    readonly chatHandleManager: ChatHandleManager
    readonly askChatHandleManager: AskChatHandleManager
    readonly outputChannel = vscode.window.createOutputChannel('vscode-able', { log: true })
    readonly ableTaskProvider: MochaJsonTaskProvider
    readonly taskWatcher: TaskWatcher
    readonly extensionUri: vscode.Uri
    readonly playwrightExecTool: PlaywrightExecTool
    readonly lean4Extension: Lean4Extension
    readonly mathRenderer: MathRenderer

    constructor(context: vscode.ExtensionContext) {
        this.chatHandleManager = new ChatHandleManager(this)
        this.askChatHandleManager = new AskChatHandleManager(this)
        this.ableTaskProvider = new MochaJsonTaskProvider(this)
        this.taskWatcher = new TaskWatcher(this)
        this.extensionUri = context.extensionUri
        this.playwrightExecTool = new PlaywrightExecTool(this)
        this.lean4Extension = new Lean4Extension(this)
        this.mathRenderer = new MathRenderer(this)
        setTimeout(async () => {
            const result = await vscode.lm.selectChatModels({ vendor: 'copilot' })
            this.outputChannel.info(`GitHub Copilot Chat available models: ${JSON.stringify(result, null, 2)}`)
            const result1 = await vscode.lm.selectChatModels({ vendor: 'gemini' })
            this.outputChannel.info(`GitHub Copilot Chat BYOK Gemini available models: ${JSON.stringify(result1, null, 2)}`)
        }, 5000)
    }

    getChatHandler() {
        return this.chatHandleManager.getHandler()
    }

    getAskChatHandler() {
        return this.askChatHandleManager.getHandler()
    }

    dispose() {
        this.playwrightExecTool.dispose()
        this.ableTaskProvider.dispose()
        this.outputChannel.dispose()
        this.taskWatcher.dispose()
        this.lean4Extension.dispose()
        void this.mathRenderer.dispose()
    }

}

export function activate(context: vscode.ExtensionContext) {
    const extension = new Extension(context)
    const geminiAuthProvider = new GeminiApiKeyAuthenticationProvider(extension, context.secrets)
    const openCodeGoAuthProvider = new OpenCodeGoApiKeyAuthenticationProvider(extension, context.secrets)
    // non stable API used
    try {
        context.subscriptions.push(
            vscode.lm.registerLanguageModelChatProvider('gemini_with_able', new GeminiChatProvider(extension)),
            vscode.lm.registerLanguageModelChatProvider('geminicli_with_able', new GeminiCliChatProvider(extension)),
            vscode.lm.registerLanguageModelChatProvider('opencodego_with_able', new OpenCodeGoChatModelProvider()),
        )
    } catch { }
    context.subscriptions.push(
        extension,
        geminiAuthProvider,
        vscode.authentication.registerAuthenticationProvider(geminiAuthProvider.serviceId, geminiAuthProvider.label, geminiAuthProvider),
        vscode.authentication.registerAuthenticationProvider(openCodeGoAuthProvider.serviceId, openCodeGoAuthProvider.label, openCodeGoAuthProvider),
        vscode.commands.registerCommand('able.loginGemini', () => {
            void vscode.authentication.getSession(geminiAuthProvider.serviceId, [], { createIfNone: true })
        }),
        vscode.commands.registerCommand('able.loginOpenCodeGo', () => {
            void vscode.authentication.getSession(openCodeGoAuthProvider.serviceId, [], { createIfNone: true })
        }),
        vscode.commands.registerCommand('able.logoutGemini', async () => {
            await geminiAuthProvider.removeSession()
        }),
        vscode.commands.registerCommand('able.logoutOpenCodeGo', async () => {
            await openCodeGoAuthProvider.removeSession()
        }),
        vscode.commands.registerCommand('able.doSomething', () => {
            void doSomething(extension)
        }),
        vscode.chat.createChatParticipant('able.chatParticipant', extension.getChatHandler()),
        vscode.chat.createChatParticipant( 'able.askParticipant', extension.getAskChatHandler()),
        vscode.lm.registerTool('able_fetch_webpage', new FetchWebPageTool(extension)),
        vscode.lm.registerTool('able_fetch_webpage_autoapprove', new FetchWebPageToolAutoApprove(extension)),
        vscode.lm.registerTool('able_web_search', new WebSearchTool(extension)),
        vscode.lm.registerTool('able_runInSandbox', new RunInSandbox(extension)),
        vscode.lm.registerTool('able_playwrightExec', extension.playwrightExecTool),
        vscode.lm.registerTool('able_playwrightExecReset', new PlaywrightExecResetTool(extension.playwrightExecTool)),
        vscode.tasks.registerTaskProvider(MochaJsonTaskProvider.AbleTaskType, extension.ableTaskProvider),
        vscode.languages.registerHoverProvider({ scheme: 'file', language: 'lean4' }, extension.mathRenderer),
        ...registerCommands()
    )

    context.environmentVariableCollection.delete('GIT_INDEX_FILE')
    if (vscode.env.appName.includes('Insiders')) {
        context.environmentVariableCollection.replace('GIT_EDITOR', 'codeInsiders -nw')
    } else {
        context.environmentVariableCollection.replace('GIT_EDITOR', 'vscode -nw')
    }
}


async function doSomething(extension: Extension) {
    try { // vscode_fetchWebPage_internal // copilot_fetchWebPage
        const result = await vscode.lm.invokeTool('able_fetch_webpage', {
            toolInvocationToken: undefined,
            input: {
                url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_expressions'
            }
        })
        const ret = await renderToolResult(result)
        extension.outputChannel.info(`[doSomething]: result:\n ${ret}`)
    } catch (e) {
        if (e instanceof Error) {
            extension.outputChannel.error(`[doSomething]: error: ${JSON.stringify([e.message, e.stack], null, 2)}`)
        }
    }
}
