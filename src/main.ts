import * as vscode from 'vscode'
import { ChatHandleManager } from './chat/chat.js'
import { registerCommands } from './commands.js'
import { PythonTool } from './lmtools/pyodide.js'
import { renderToolResult } from './utils/toolresult.js'
import { MochaJsonTaskProvider } from './task.js'
import { TaskWatcher } from './taskwatcher.js'
import { GitExtension } from '../types/git/git.js'
import { ExternalPromise } from './utils/externalpromise.js'


class Extension {
    readonly chatHandleManager: ChatHandleManager
    readonly outputChannel = vscode.window.createOutputChannel('vscode-able', { log: true })
    readonly ableTaskProvider: MochaJsonTaskProvider
    readonly taskWatcher: TaskWatcher
    readonly gitExtension = new ExternalPromise<GitExtension | undefined>()

    constructor() {
        this.chatHandleManager = new ChatHandleManager(this)
        this.ableTaskProvider = new MochaJsonTaskProvider(this)
        this.taskWatcher = new TaskWatcher(this)
        setTimeout(() => {
            const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git')
            this.gitExtension.resolve(gitExtension?.exports)
        }, 1000)
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
    context.subscriptions.push(
        extension,
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
