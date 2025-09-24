import * as vscode from 'vscode'
import { MutexWithSizedQueue } from '../utils/mutexwithsizedqueue.js'
import { debugObj } from '../utils/debug.js'


interface TaskWatcherEntry {
    name?: string | undefined, // e.g. "task-lint"
    globPattern: string[]
}

export class TaskWatcher implements vscode.Disposable {
    private watchers: vscode.FileSystemWatcher[] = []
    private readonly configToDispose: vscode.Disposable
    private readonly mutex = new MutexWithSizedQueue(1)

    constructor(private readonly extension: {
        readonly outputChannel: vscode.LogOutputChannel
    }) {
        this.initWatcher()
        this.configToDispose = vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('able.taskWatcher')) {
                this.initWatcher()
            }
        })
    }

    initWatcher() {
        this.resetWatchers()
        const configuration = vscode.workspace.getConfiguration('able')
        const taskWatchEntries = configuration.get('taskWatcher', []) as TaskWatcherEntry[]

        for (const entry of taskWatchEntries) {
            for (const entryGlobPattern of entry.globPattern) {
                const globPattern = entryGlobPattern.startsWith('./') ? entryGlobPattern.slice(2) : entryGlobPattern
                const executeTaskCb = async () => {
                    const tasks = await vscode.tasks.fetchTasks()
                    debugObj('Fetched tasks: ', tasks.filter(t => !t.definition['path']).map(t => ({ name: t.name, definition: t.definition })), this.extension.outputChannel)
                    const task = tasks.find(t => t.name === entry.name && t.name !== t.definition['script'])
                    if (task) {
                        const release = await this.mutex.acquire()
                        const disposable = vscode.tasks.onDidEndTask((e) => {
                            debugObj('Task ended: ', { name: e.execution.task.name, definition: e.execution.task.definition }, this.extension.outputChannel)
                            if (e.execution.task.name === task.name && e.execution.task.definition.type === task.definition.type) {
                                release()
                                disposable.dispose()
                            }
                        })
                        await vscode.commands.executeCommand('workbench.action.tasks.runTask', { type: task.definition.type, name: task.name })
                        debugObj('Executed task: ', { name: task.name, type: task.definition.type }, this.extension.outputChannel)
                    }
                }
                for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
                    const pattern = new vscode.RelativePattern(workspaceFolder, globPattern)
                    const watcher = vscode.workspace.createFileSystemWatcher(pattern)
                    this.watchers.push(watcher)
                    watcher.onDidChange(async (e) => {
                        debugObj('File changed: ', e, this.extension.outputChannel)
                        await executeTaskCb()
                    })
                    watcher.onDidCreate(async (e) => {
                        debugObj('File created: ', e, this.extension.outputChannel)
                        await executeTaskCb()
                    })
                    watcher.onDidDelete(async (e) => {
                        debugObj('File deleted: ', e, this.extension.outputChannel)
                        await executeTaskCb()
                    })
                }
            }
        }
    }

    resetWatchers() {
        vscode.Disposable.from(...this.watchers).dispose()
        this.watchers = []
    }

    dispose() {
        this.resetWatchers()
        this.configToDispose.dispose()
    }

}
