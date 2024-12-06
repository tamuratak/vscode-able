import * as vscode from 'vscode'
import { handler } from './chat/chat'
import { registerCommands } from './commands'


export function activate(context: vscode.ExtensionContext) {
    vscode.chat.createChatParticipant('able.chatParticipant', handler)
    context.subscriptions.push(...registerCommands())

    context.environmentVariableCollection.delete('GIT_INDEX_FILE')
    if (vscode.env.appName.includes('Insiders')) {
        context.environmentVariableCollection.replace('GIT_EDITOR', 'codeInsiders -nw')
    } else {
        context.environmentVariableCollection.replace('GIT_EDITOR', 'vscode -nw')
    }

}
