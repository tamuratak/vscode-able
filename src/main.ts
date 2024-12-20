import * as vscode from 'vscode'
import { ChatHandler } from './chat/chat.js'
import { registerCommands } from './commands.js'
import { OpenAiApiKeyAuthenticationProvider } from './chat/auth/authproviders.js'


export class Extension {
    private readonly handler: ChatHandler
    constructor(public readonly openAiServiceId: string) {
        this.handler = new ChatHandler(openAiServiceId)
    }

    getHandler() {
        return this.handler.getHandler()
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
        vscode.chat.createChatParticipant('able.chatParticipant', extension.getHandler()),
        vscode.commands.registerCommand('able.activateCopilotChatModels', () => {
            void extension.activate()
        }),
        ...registerCommands()
    )

    context.environmentVariableCollection.delete('GIT_INDEX_FILE')
    if (vscode.env.appName.includes('Insiders')) {
        context.environmentVariableCollection.replace('GIT_EDITOR', 'codeInsiders -nw')
    } else {
        context.environmentVariableCollection.replace('GIT_EDITOR', 'vscode -nw')
    }

}
