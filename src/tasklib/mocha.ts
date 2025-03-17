import * as cp from 'node:child_process'
import * as vscode from 'vscode'
import { ExternalPromise } from '../utils/externalpromise.js'
export { type MochaJsonResult } from './mochalib/mochajson.js'

/**
 * Return VS Code tasks that run Mocha tests with a JSON reporter.
 */
export async function findMochaJsonTestCommand() {
    const tasks = await vscode.tasks.fetchTasks()
    const mochaJsonCmds = tasks
    .filter(task => {
        if (task.definition.type === 'npm' && !task.definition['path'] && typeof task.definition['script'] === 'string') {
            if (task.definition['script'] === 'test' || task.definition['script'].startsWith('test:')) {
                if (task.detail?.includes('mocha') && task.detail.match(/reporter.*json/)) {
                    return true
                }
            }
        }
        return false
    })
    return mochaJsonCmds
}


export function executeMochaCommand(task: vscode.Task) {
    if (task.execution instanceof vscode.ShellExecution) {
        const command = task.execution.command
        if (typeof command !== 'string') {
            throw new Error('Command is not a string')
        }
        const args: string[] = []
        for (const arg of task.execution.args) {
            if (typeof arg === 'string') {
                args.push(arg)
            } else {
                throw new Error('Arguments are not all strings')
            }
        }
        const options = task.execution.options?.cwd ? { cwd: task.execution.options.cwd } : {}
        const child = cp.spawn(command, args, options)
        const resultPromise = new ExternalPromise<string>()
        let output = ''
        const decoder = new TextDecoder()
        child.stdout.on('data', (data: Uint8Array) => {
            output += decoder.decode(data)
        })
        child.stderr.on('data', (data: Uint8Array) => {
            console.error(`stderr: ${decoder.decode(data)}`)
        })
        child.on('close', () => {
            resultPromise.resolve(output)
        })
        return resultPromise.promise
    } else {
        throw new Error('Execution is not a ShellExecution')
    }
}
