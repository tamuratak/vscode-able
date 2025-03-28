import * as vscode from 'vscode'
import { convertToCollections, executeMochaCommand, findMochaJsonTestCommand } from './tasklib/mocha.js'
import { collectMochaJsonFailures } from './tasklib/mochalib/mochajson.js'


export class MochaJsonTaskProvider implements vscode.TaskProvider {
    static AbleTaskType = 'abletask'
    private readonly tasks: Promise<vscode.Task[]>
    private readonly collection = vscode.languages.createDiagnosticCollection('AbleTask')

    constructor(private readonly extension: {
        readonly outputChannel: vscode.LogOutputChannel
    }) {
        this.tasks = this.initTasks()
    }

    private async initTasks() {
        const mochaJsonTasks = await findMochaJsonTestCommand()
        const tasks = mochaJsonTasks.map(task => {
            return new vscode.Task(
                { type: MochaJsonTaskProvider.AbleTaskType },
                vscode.TaskScope.Workspace,
                task.name,
                MochaJsonTaskProvider.AbleTaskType,
                new vscode.CustomExecution(() => {
                    return Promise.resolve(
                        new SimpleTaskTerminal(async () => {
                            try {
                                this.collection.clear()
                                const output = await executeMochaCommand(task)
                                const failures = collectMochaJsonFailures(output)
                                const diagEntries = await convertToCollections(failures)
                                for (const entry of diagEntries.values()) {
                                    this.collection.set(entry.uri, entry.diags)
                                }
                            } catch (error) {
                                if (error instanceof Error) {
                                    this.extension.outputChannel.error('Error executing task: ', error)
                                } else {
                                    console.log('Error executing task: ', error)
                                }
                            }
                        })
                    )
                }),
                []
            )
        })

        return tasks
    }

    public provideTasks() {
        return this.tasks
    }

    public resolveTask() {
        return undefined
    }

    dispose() {
        this.collection.dispose()
    }

}

class SimpleTaskTerminal implements vscode.Pseudoterminal {
    private readonly writeEmitter = new vscode.EventEmitter<string>()
    onDidWrite: vscode.Event<string> = this.writeEmitter.event
    private readonly closeEmitter = new vscode.EventEmitter<number>()
    onDidClose: vscode.Event<number> = this.closeEmitter.event
    private readonly cb: (emitter: vscode.EventEmitter<string>) => void

    constructor(cb: (emitter: vscode.EventEmitter<string>) => void) {
        this.cb = cb
    }

    open(): void {
        void this.doBuild()
    }

    close(): void {
        this.closeEmitter.dispose()
        this.writeEmitter.dispose()
    }

    private doBuild() {
        try {
            this.writeEmitter.fire('Starting ...\r\n')
            this.cb(this.writeEmitter)
            this.writeEmitter.fire('Complete.\r\n\r\n')
        } finally {
            this.closeEmitter.fire(0)
        }
    }

}
