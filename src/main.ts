import * as vscode from 'vscode'
import { ChatHandleManager } from './chat/chat.js'
import { registerCommands } from './commands.js'
import { PythonTool } from './lmtools/pyodide.js'
//import { renderToolResult } from './utils/toolresult.js'
import { MochaJsonTaskProvider } from './task/task.js'
import { TaskWatcher } from './task/taskwatcher.js'
import { GeminiApiKeyAuthenticationProvider, GroqApiKeyAuthenticationProvider, OpenAiApiAuthenticationProvider } from './auth/authproviders.js'
import { GeminiChatProvider, GroqChatProvider, OpenAIChatProvider } from './chat/chatprovider.js'
import { WebSearchTool } from './lmtools/websearch.js'
import { RunInSandbox } from './lmtools/runinsandbox.js'
import { AnnotationTool } from './lmtools/annotation.js'


class Extension {
    readonly chatHandleManager: ChatHandleManager
    readonly outputChannel = vscode.window.createOutputChannel('vscode-able', { log: true })
    readonly ableTaskProvider: MochaJsonTaskProvider
    readonly taskWatcher: TaskWatcher

    constructor() {
        this.chatHandleManager = new ChatHandleManager(this)
        this.ableTaskProvider = new MochaJsonTaskProvider(this)
        this.taskWatcher = new TaskWatcher(this)
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

    dispose() {
        this.ableTaskProvider.dispose()
        this.outputChannel.dispose()
        this.taskWatcher.dispose()
    }

}

export const AbleChatParticipantId = 'able.chatParticipant'

export function activate(context: vscode.ExtensionContext) {
    const extension = new Extension()
    const geminiAuthProvider = new GeminiApiKeyAuthenticationProvider(extension, context.secrets)
    const openAiAuthProvider = new OpenAiApiAuthenticationProvider(extension, context.secrets)
    const groqAuthProvider = new GroqApiKeyAuthenticationProvider(extension, context.secrets)
    context.subscriptions.push(
        extension,
        vscode.lm.registerLanguageModelChatProvider('gemini_with_able', new GeminiChatProvider(extension)),
        vscode.lm.registerLanguageModelChatProvider('openai_with_able', new OpenAIChatProvider(extension)),
        vscode.lm.registerLanguageModelChatProvider('groq_with_able', new GroqChatProvider(extension)),
        geminiAuthProvider,
        openAiAuthProvider,
        groqAuthProvider,
        vscode.authentication.registerAuthenticationProvider(geminiAuthProvider.serviceId, geminiAuthProvider.label, geminiAuthProvider),
        vscode.authentication.registerAuthenticationProvider(openAiAuthProvider.serviceId, openAiAuthProvider.label, openAiAuthProvider),
        vscode.authentication.registerAuthenticationProvider(groqAuthProvider.serviceId, groqAuthProvider.label, groqAuthProvider),
        vscode.commands.registerCommand('able.loginGemini', () => {
            void vscode.authentication.getSession(geminiAuthProvider.serviceId, [], { createIfNone: true })
        }),
        vscode.commands.registerCommand('able.loginOpenAI', () => {
            void vscode.authentication.getSession(openAiAuthProvider.serviceId, [], { createIfNone: true })
        }),
        vscode.commands.registerCommand('able.loginGroq', () => {
            void vscode.authentication.getSession(groqAuthProvider.serviceId, [], { createIfNone: true })
        }),
        vscode.commands.registerCommand('able.doSomething', () => {
            void doSomething(extension)
        }),
        vscode.chat.createChatParticipant(AbleChatParticipantId, extension.getChatHandler()),
        vscode.lm.registerTool('able_python', new PythonTool()),
        vscode.lm.registerTool('able_web_search', new WebSearchTool(extension)),
        vscode.lm.registerTool('able_run_in_sandbox', new RunInSandbox(extension)),
        vscode.lm.registerTool('able_annotation', new AnnotationTool(extension)),
        vscode.tasks.registerTaskProvider(MochaJsonTaskProvider.AbleTaskType, extension.ableTaskProvider),
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
    const activeDocument = vscode.window.activeTextEditor?.document
    if (!activeDocument) {
        return
    }
    const code = activeDocument.getText(new vscode.Range(0, 0, 10, 0))
    const result = await vscode.lm.invokeTool('able_annotation', {
        toolInvocationToken: undefined,
        input: {
          filePath: activeDocument.uri.fsPath,
          code
        }
    })
    extension.outputChannel.debug(`[doSomething]: ${JSON.stringify(result)}`)
    return
}
