import { loadPyodide } from '#pyodide'
import * as workerpool from 'workerpool'


async function runPythonAsync(code: string): Promise<string> {
    const pyodide = await loadPyodide()
    const ret = await pyodide.runPythonAsync(code) as unknown
    return JSON.stringify(ret)
}

const workers = {runPythonAsync}

// workerpool passes the resolved value of Promise, not Promise.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type IPyodideWorker = {
    runPythonAsync: (code: string) => string
}

workerpool.worker(workers)
