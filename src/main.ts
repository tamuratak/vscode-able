import * as vscode from 'vscode'
import { ChatHandleManager } from './chat/chat.js'
import { registerCommands } from './commands.js'
import { OpenAiApiKeyAuthenticationProvider } from './chat/auth/authproviders.js'
import { PythonTool } from './lmtools/pyodide.js'
import { EditTool } from './lmtools/edit.js'


export class Extension {
    private readonly handler: ChatHandleManager
    private readonly editTool: EditTool

    constructor(public readonly openAiServiceId: string) {
        this.handler = new ChatHandleManager(openAiServiceId)
        this.editTool = new EditTool(this.handler)
    }

    getChatHandler() {
        return this.handler.getHandler()
    }

    getEditTool() {
        return this.editTool
    }

    quickPickModel() {
        return this.handler.quickPickModel()
    }

    async activate() {
        await this.handler.initGpt4oMini()
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
        vscode.lm.registerTool('able_edit', extension.getEditTool()),
        ...registerCommands()
    )

    context.environmentVariableCollection.delete('GIT_INDEX_FILE')
    if (vscode.env.appName.includes('Insiders')) {
        context.environmentVariableCollection.replace('GIT_EDITOR', 'codeInsiders -nw')
    } else {
        context.environmentVariableCollection.replace('GIT_EDITOR', 'vscode -nw')
    }

}
