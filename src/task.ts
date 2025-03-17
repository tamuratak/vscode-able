import * as vscode from 'vscode'
import { executeMochaCommand, findMochaJsonTestCommand } from './tasklib/mocha.js'


export class AbleTaskProvider implements vscode.TaskProvider {
    static AbleTaskType = 'abletask'
    private readonly tasks: Promise<vscode.Task[]>

    constructor(private readonly extension: {
        readonly outputChannel: vscode.LogOutputChannel
    }) {
        this.tasks = this.initTasks()
    }

    private async initTasks() {
        const mochaJsonTasks = await findMochaJsonTestCommand()
        const tasks = mochaJsonTasks.map(task => {
            return new vscode.Task(
                { type: AbleTaskProvider.AbleTaskType },
                vscode.TaskScope.Workspace,
                task.name,
                AbleTaskProvider.AbleTaskType,
                new vscode.CustomExecution(() => {
                    return Promise.resolve(
                        new SimpleTaskTerminal(async (emitter) => {
                            try {
//                                const collection = vscode.languages.createDiagnosticCollection(task.name)
                                // TODO
                                const json = await executeMochaCommand(task)
                                const result = JSON.parse(json) as unknown
                                emitter.fire(json)
                                console.log('Mocha test result: ', result)
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
