import * as vscode from 'vscode'
import { ChatHandleManager } from './chat/chat.js'
import { registerCommands } from './commands.js'
import { OpenAiApiKeyAuthenticationProvider } from './chat/auth/authproviders.js'
import { PythonTool } from './lmtools/pyodide.js'
import { EditTool } from './lmtools/edit.js'
import { ListDirTool, ReadFileTool, RepositoryTreeTool } from './lmtools/fstools.js'
import { renderToolResult } from './utils/toolresult.js'


class Extension {
    readonly chatHandleManager: ChatHandleManager
    readonly editTool: EditTool
    readonly outputChannel = vscode.window.createOutputChannel('vscode-able', { log: true })
    readonly readFileTool: ReadFileTool
    readonly repositoryTreeTool: RepositoryTreeTool
    readonly listDirTool: ListDirTool

    constructor(public readonly openAiServiceId: string) {
        this.chatHandleManager = new ChatHandleManager(openAiServiceId, this)
        this.editTool = new EditTool(this)
        this.readFileTool = new ReadFileTool(this)
        this.repositoryTreeTool = new RepositoryTreeTool(this)
        this.listDirTool = new ListDirTool(this)
    }

    getChatHandler() {
        return this.chatHandleManager.getHandler()
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
        vscode.commands.registerCommand('able.doSomething', () => {
            void doSomething()
        }),
        vscode.chat.createChatParticipant('able.chatParticipant', extension.getChatHandler()),
        vscode.commands.registerCommand('able.activateCopilotChatModels', () => {
            void extension.activate()
        }),
        vscode.lm.registerTool('able_python', new PythonTool()),
        vscode.lm.registerTool('able_replace_text', extension.editTool),
        vscode.lm.registerTool('able_read_file', extension.readFileTool),
        vscode.lm.registerTool('able_repository_tree', extension.repositoryTreeTool),
        vscode.lm.registerTool('able_list_dir', extension.listDirTool),
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
    const tool = vscode.lm.tools.find(e => e.name === 'able_list_dir')
    if (!tool) {
        return
    }
    const result = await vscode.lm.invokeTool(tool.name, {
        toolInvocationToken: undefined,
        input: { dir: '/Users/tamura/src/github/LaTeX-Workshop' }
    })
    console.log(result)
    const value = await renderToolResult(result)
    console.log(value)
}
