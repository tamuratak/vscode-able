import * as vscode from 'vscode'
import { ChatHandleManager } from './chat/chat.js'
import { registerCommands } from './commands.js'
import { OpenAiApiKeyAuthenticationProvider } from './chat/auth/authproviders.js'
import { PythonTool } from './lmtools/pyodide.js'
import { EditTool } from './lmtools/edit.js'
import { CountTool } from './lmtools/countcharacters.js'


class Extension {
    readonly chatHandleManager: ChatHandleManager
    readonly editTool: EditTool
    readonly countTool: CountTool
    readonly outputChannel = vscode.window.createOutputChannel('vscode-able', { log: true })

    constructor(public readonly openAiServiceId: string) {
        this.chatHandleManager = new ChatHandleManager(openAiServiceId, this)
        this.editTool = new EditTool(this)
        this.countTool = new CountTool(this)
    }

    getChatHandler() {
        return this.chatHandleManager.getHandler()
    }

    getEditTool() {
        return this.editTool
    }

    getCountTool() {
        return this.countTool
    }

    quickPickModel() {
        return this.chatHandleManager.quickPickModel()
    }

    async activate() {
        await this.chatHandleManager.initGpt4oMini()
    }

}

export function activate(context: vscode.ExtensionContext) {
    const openAiAuthProvider = new OpenAiApiKeyAuthenticationProvider(context.secrets)
    const extension = new Extension(openAiAuthProvider.serviceId)
    context.subscriptions.push(
        openAiAuthProvider,
        vscode.authentication.registerAuthenticationProvider(openAiAuthProvider.serviceId, openAiAuthProvider.label, openAiAuthProvider),
        vscode.commands.registerCommand('able.loginOpenAI', () => {
            void vscode.authentication.getSession(openAiAuthProvider.serviceId, [], { createIfNone: true })
        }),
        vscode.commands.registerCommand('able.quickPickModel', () => {
            void extension.quickPickModel()
        }),
        vscode.chat.createChatParticipant('able.chatParticipant', extension.getChatHandler()),
        vscode.commands.registerCommand('able.activateCopilotChatModels', () => {
            void extension.activate()
        }),
        vscode.lm.registerTool('able_python', new PythonTool()),
        vscode.lm.registerTool('able_replace_text', extension.getEditTool()),
        vscode.lm.registerTool('able_count_characters', extension.getCountTool()),
        ...registerCommands()
    )

    context.environmentVariableCollection.delete('GIT_INDEX_FILE')
    if (vscode.env.appName.includes('Insiders')) {
        context.environmentVariableCollection.replace('GIT_EDITOR', 'codeInsiders -nw')
    } else {
        context.environmentVariableCollection.replace('GIT_EDITOR', 'vscode -nw')
    }

}
