import * as vscode from 'vscode'
import { ChatHandleManager } from './chat/chat.js'
import { registerCommands } from './commands.js'
import { PythonTool } from './lmtools/pyodide.js'
import { renderToolResult } from './utils/toolresult.js'
import { MochaJsonTaskProvider } from './task/task.js'
import { TaskWatcher } from './task/taskwatcher.js'
import { CerebrasApiKeyAuthenticationProvider, GeminiApiKeyAuthenticationProvider, geminiAuthServiceId, GroqApiKeyAuthenticationProvider, OpenAiApiAuthenticationProvider } from './auth/authproviders.js'
import { GoogleGenAI, Model } from '@google/genai'
import { GeminiChatProvider, OpenAIChatProvider } from './chat/chatprovider.js'


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
            this.outputChannel.info(`Available copilot chat models: ${JSON.stringify(result, null, 2)}`)
            const result1 = await vscode.lm.selectChatModels({ vendor: 'gemini' })
            this.outputChannel.info(`Available gemini BYOK chat models: ${JSON.stringify(result1, null, 2)}`)
            try {
                const session = await vscode.authentication.getSession(geminiAuthServiceId, [])
                if (session) {
                    const apiKey = session.accessToken
                    const ai = new GoogleGenAI({apiKey})
                    const modelList: Model[] = []
                    for await (const model of await ai.models.list()) {
                        modelList.push(model)
                    }
                    this.outputChannel.info(`Gemini (with Able) models: ${JSON.stringify(modelList, null, 2)}`)
                }
            } catch { }
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
    const cerebrasAuthProvider = new CerebrasApiKeyAuthenticationProvider(extension, context.secrets)
    const groqAuthProvider = new GroqApiKeyAuthenticationProvider(extension, context.secrets)
    context.subscriptions.push(
        extension,
        vscode.lm.registerChatModelProvider('gemini_with_able', new GeminiChatProvider(extension)),
        vscode.lm.registerChatModelProvider('openai_with_able', new OpenAIChatProvider(extension)),
        geminiAuthProvider,
        openAiAuthProvider,
        cerebrasAuthProvider,
        groqAuthProvider,
        vscode.authentication.registerAuthenticationProvider(geminiAuthProvider.serviceId, geminiAuthProvider.label, geminiAuthProvider),
        vscode.authentication.registerAuthenticationProvider(openAiAuthProvider.serviceId, openAiAuthProvider.label, openAiAuthProvider),
        vscode.authentication.registerAuthenticationProvider(cerebrasAuthProvider.serviceId, cerebrasAuthProvider.label, cerebrasAuthProvider),
        vscode.authentication.registerAuthenticationProvider(groqAuthProvider.serviceId, groqAuthProvider.label, groqAuthProvider),
        vscode.commands.registerCommand('able.loginGemini', () => {
            void vscode.authentication.getSession(geminiAuthProvider.serviceId, [], { createIfNone: true })
        }),
        vscode.commands.registerCommand('able.loginOpenAI', () => {
            void vscode.authentication.getSession(openAiAuthProvider.serviceId, [], { createIfNone: true })
        }),
        vscode.commands.registerCommand('able.loginCerebras', () => {
            void vscode.authentication.getSession(cerebrasAuthProvider.serviceId, [], { createIfNone: true })
        }),
        vscode.commands.registerCommand('able.loginGroq', () => {
            void vscode.authentication.getSession(groqAuthProvider.serviceId, [], { createIfNone: true })
        }),
        vscode.commands.registerCommand('able.doSomething', () => {
            void doSomething()
        }),
        vscode.chat.createChatParticipant(AbleChatParticipantId, extension.getChatHandler()),
        vscode.lm.registerTool('able_python', new PythonTool()),
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


async function doSomething() {
    const cmds0 = await vscode.tasks.fetchTasks()
    const cmds = cmds0.map(cmd => [cmd.definition, cmd.name])
    console.log(JSON.stringify(cmds, null, 2))
    const models = await vscode.lm.selectChatModels({vendor: 'copilot'})
    console.log(JSON.stringify(models, null, 2))
    const tool = vscode.lm.tools.find(e => e.name === 'able_list_dir')
    if (!tool) {
        return
    }
    const result = await vscode.lm.invokeTool(tool.name, {
        toolInvocationToken: undefined,
        input: { path: '/Users/tamura/src/github/LaTeX-Workshop' }
    })
    console.log(result)
    const value = await renderToolResult(result)
    console.log(value)
}
