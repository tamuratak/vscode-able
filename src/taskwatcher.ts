import * as vscode from 'vscode'


interface TaskWatcherEntry {
    name?: string | undefined, // e.g. "task-lint"
    globPattern: string
}

export class TaskWatcher implements vscode.Disposable {
    private watchers: vscode.FileSystemWatcher[] = []
    private readonly configToDispose: vscode.Disposable

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
            const watcher = vscode.workspace.createFileSystemWatcher(entry.globPattern)
            this.watchers.push(watcher)
            const executeTaskCb = async () => {
                const tasks = await vscode.tasks.fetchTasks()
                const task = tasks.find(t => t.name === entry.name && t.name !== t.definition['script'])
                if (task) {
                    await vscode.commands.executeCommand('workbench.action.tasks.runTask', task.name)
                }
            }
            watcher.onDidChange(async (e) => {
                this.extension.outputChannel.debug(`File changed: ${e}`)
                await executeTaskCb()
            })
            watcher.onDidCreate(async (e) => {
                this.extension.outputChannel.debug(`File created: ${e}`)
                await executeTaskCb()
            })
            watcher.onDidDelete(async (e) => {
                this.extension.outputChannel.debug(`File deleted: ${e}`)
                await executeTaskCb()
            })
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
