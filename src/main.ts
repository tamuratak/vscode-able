import * as vscode from 'vscode'
import { ChatHandler } from './chat/chat'
import { registerCommands } from './commands'
import { OpenAiApiKeyAuthenticationProvider } from './chat/auth/authproviders'


export class Extension {
    readonly handler: ChatHandler
    constructor(public readonly openAiServiceId: string) {
        this.handler = new ChatHandler(openAiServiceId)
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
        vscode.chat.createChatParticipant('able.chatParticipant', extension.handler.getHandler()),
        ...registerCommands()
    )

    context.environmentVariableCollection.delete('GIT_INDEX_FILE')
    if (vscode.env.appName.includes('Insiders')) {
        context.environmentVariableCollection.replace('GIT_EDITOR', 'codeInsiders -nw')
    } else {
        context.environmentVariableCollection.replace('GIT_EDITOR', 'vscode -nw')
    }

}
