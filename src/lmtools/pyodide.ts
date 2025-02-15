import * as path from 'node:path'
import * as workerpool from 'workerpool'
import { IPyodideWorker } from './pyodidelib/pyodide_worker.js'
import { CancellationToken, LanguageModelTextPart, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolInvocationPrepareOptions, LanguageModelToolResult, MarkdownString, PreparedToolInvocation } from 'vscode'

const pool = workerpool.pool(
    path.join(__dirname, 'pyodidelib', 'pyodide_worker.js'),
    { minWorkers: 1, maxWorkers: 1, workerType: 'thread' }
)
export const proxyPromise = pool.proxy<IPyodideWorker>()

export interface PythonCodeInput {
    code: string
    reason?: string | undefined
}

export class PythonTool implements LanguageModelTool<PythonCodeInput> {

    constructor() {
        console.log('PythonTool created')
    }

    async invoke(options: LanguageModelToolInvocationOptions<PythonCodeInput>, token: CancellationToken) {
        const { code } = options.input
        const proxy = await proxyPromise
        if (token.isCancellationRequested) {
            throw new Error('Cancelled')
        }
        const resultPromise = proxy.runPythonAsync(code)
        token.onCancellationRequested(() => resultPromise.cancel())
        const result = await resultPromise
        return new LanguageModelToolResult([new LanguageModelTextPart(result)])
    }

    prepareInvocation(options: LanguageModelToolInvocationPrepareOptions<PythonCodeInput>): PreparedToolInvocation {
        const message = new MarkdownString('Run Python code:\n\n```python\n' + options.input.code + '\n```')
        return {
            confirmationMessages: {
                title: 'Run Python code?',
                message
            },
            invocationMessage: 'Running Python code...'
        }
    }

}
