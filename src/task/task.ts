import * as vscode from 'vscode'
import { convertToCollections, executeMochaCommand, findMochaJsonTestCommand } from './tasklib/mocha.js'
import { collectMochaJsonFailures } from './tasklib/mochalib/mochajson.js'
import { debugObj } from '../utils/debug.js'


//
// Provides VS Code tasks that run Mocha tests with a JSON reporter and collect
// failures as VS Code diagnostics.
//
// ## Task discovery
//
// This provider calls `vscode.tasks.fetchTasks()` and filters the workspace's configured tasks
// from `package.json` and `tasks.json`.
//
// A script in `package.json` qualifies if:
//
//  1. Its name is "test" or starts with "test:".
//  2. Its command includes both "mocha" and "reporter" with "json".
//
// For example:
//
//   "scripts": {
//     "test:witsandbox:json": "sandbox-exec.js -c -- zsh -c 'mocha --require source-map-support/register --reporter json --ui tdd out/test/unittest/**/*.js'",
//   }
//
// The script must also be configured as a task in `.vscode/tasks.json`:
//
// {
//   "label": "task-test-json",
//   "type": "npm",
//   "script": "test:witsandbox:json",
//   "group": {
//     "kind": "test",
//     "isDefault": true
//   },
//   "problemMatcher": []
// }
//
// Each matching task is wrapped in a new `vscode.Task` with a
// `CustomExecution` backed by a `SimpleTaskTerminal` (see below).
// The new task's name is prefixed with "abletask-", e.g. "abletask-task-test-json", to distinguish it from the original.
//
export class MochaJsonTaskProvider implements vscode.TaskProvider {
    static AbleTaskType = 'abletask' as const
    private readonly tasks: Promise<vscode.Task[]>
    private readonly collection = vscode.languages.createDiagnosticCollection('AbleTask')

    constructor(private readonly extension: {
        readonly outputChannel: vscode.LogOutputChannel
    }) {
        this.tasks = this.initTasks()
    }

    private async initTasks() {
        const mochaJsonTasks = await findMochaJsonTestCommand()
        const tasks: vscode.Task[] = []
        for (const task of mochaJsonTasks) {
            const newTask = new vscode.Task(
                { type: MochaJsonTaskProvider.AbleTaskType },
                vscode.TaskScope.Workspace,
                `${MochaJsonTaskProvider.AbleTaskType}-${task.name}`,
                MochaJsonTaskProvider.AbleTaskType,
                new vscode.CustomExecution(() => {
                    return Promise.resolve(
                        new SimpleTaskTerminal(async (writeEmitter) => {
                            try {
                                writeEmitter.fire('Starting ...\r\n')
                                this.collection.clear()
                                const output = await executeMochaCommand(task)
                                writeEmitter.fire(output.replace(/\n/g, '\r\n'))
                                const failures = collectMochaJsonFailures(output)
                                const diagEntries = await convertToCollections(failures)
                                for (const entry of diagEntries.values()) {
                                    this.collection.set(entry.uri, entry.diags)
                                }
                            } catch (error) {
                                debugObj('MochaJsonTaskProvider error', error, this.extension.outputChannel)
                                throw error
                            } finally {
                                writeEmitter.fire('\r\nComplete.\r\n\r\n')
                            }
                        })
                    )
                }),
                []
            )
            newTask.presentationOptions = {
                reveal: vscode.TaskRevealKind.Never,
                clear: true,
                close: false,
                panel: vscode.TaskPanelKind.Dedicated
            }
            debugObj('MochaJsonTaskProvider created task', { name: newTask.name }, this.extension.outputChannel)
            tasks.push(newTask)
        }

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

    constructor(
        private readonly taskCb: (writeEmitter: vscode.EventEmitter<string>) => Promise<void>
    ) { }

    open(): void {
        void this.doTask()
    }

    close(): void {
        this.closeEmitter.dispose()
        this.writeEmitter.dispose()
    }

    private async doTask() {
        try {
            await this.taskCb(this.writeEmitter)
        } finally {
            this.closeEmitter.fire(0)
        }
    }

}
