import * as vscode from 'vscode'
import { ChatHandleManager } from './chat/chat.js'
import { registerCommands } from './commands.js'
import { MochaJsonTaskProvider } from './task/task.js'
import { TaskWatcher } from './task/taskwatcher.js'
import { GeminiApiKeyAuthenticationProvider, OpenCodeGoApiKeyAuthenticationProvider } from './auth/authproviders.js'
import { GeminiChatProvider, OpenCodeGoChatModelProvider } from './chatprovider/chatprovider.js'
import { WebSearchTool } from './lmtools/websearch.js'
import { RunInSandbox } from './lmtools/runinsandbox.js'
import { FetchWebPageTool, FetchWebPageToolAutoApprove } from './lmtools/fetchwebpage.js'
import { AskChatHandleManager } from './chat/ask.js'
import { PlaywrightExecResetTool, PlaywrightExecTool } from './playwright_exec/playwrightexectool.js'
import { Lean4Extension } from './lean4.js'
import { MathRenderer } from './mathjax/mathrenderer.js'


export function activate(context: vscode.ExtensionContext) {
    const outputChannel = vscode.window.createOutputChannel('vscode-able', { log: true })
    const extensionUri = context.extensionUri
    const chatHandleManager = new ChatHandleManager({ outputChannel })
    const askChatHandleManager = new AskChatHandleManager({ outputChannel })
    const ableTaskProvider = new MochaJsonTaskProvider({ outputChannel })
    const taskWatcher = new TaskWatcher()
    const playwrightExecTool = new PlaywrightExecTool({ outputChannel, extensionUri })
    const lean4Extension = new Lean4Extension({ outputChannel })
    const mathRenderer = new MathRenderer({ outputChannel })

    const geminiAuthProvider = new GeminiApiKeyAuthenticationProvider({ outputChannel }, context.secrets)
    const openCodeGoAuthProvider = new OpenCodeGoApiKeyAuthenticationProvider({ outputChannel }, context.secrets)
    const runInSandbox = new RunInSandbox()
    const openCodeGoProvider = new OpenCodeGoChatModelProvider()

    try {
        context.subscriptions.push(
            vscode.lm.registerLanguageModelChatProvider('gemini_with_able', new GeminiChatProvider({ outputChannel })),
            vscode.lm.registerLanguageModelChatProvider('opencodego_with_able', openCodeGoProvider),
        )
    } catch { }
    context.subscriptions.push(
        ableTaskProvider,
        taskWatcher,
        lean4Extension,
        mathRenderer,
        outputChannel,
        playwrightExecTool,
        runInSandbox,
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
        vscode.commands.registerCommand('able.abortRequest', () => {
            openCodeGoProvider.abortActiveRequests()
        }),
        vscode.chat.createChatParticipant('able.chatParticipant', chatHandleManager.getHandler()),
        vscode.chat.createChatParticipant( 'able.askParticipant', askChatHandleManager.getHandler()),
        vscode.lm.registerTool('able_fetch_webpage', new FetchWebPageTool({ outputChannel })),
        vscode.lm.registerTool('able_fetch_webpage_autoapprove', new FetchWebPageToolAutoApprove({ outputChannel })),
        vscode.lm.registerTool('able_web_search', new WebSearchTool({ outputChannel })),
        vscode.lm.registerTool('able_runInSandbox', runInSandbox),
        vscode.lm.registerTool('able_playwrightExec', playwrightExecTool),
        vscode.lm.registerTool('able_playwrightExecReset', new PlaywrightExecResetTool(playwrightExecTool)),
        vscode.tasks.registerTaskProvider(MochaJsonTaskProvider.AbleTaskType, ableTaskProvider),
        vscode.languages.registerHoverProvider({ scheme: 'file', language: 'lean4' }, mathRenderer),
        ...registerCommands()
    )

    context.environmentVariableCollection.delete('GIT_INDEX_FILE')
    if (vscode.env.appName.includes('Insiders')) {
        context.environmentVariableCollection.replace('GIT_EDITOR', 'codeInsiders -nw')
    } else {
        context.environmentVariableCollection.replace('GIT_EDITOR', 'vscode -nw')
    }
}
