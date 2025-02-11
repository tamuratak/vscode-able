import { loadPyodide } from '#pyodide'
import * as workerpool from 'workerpool'


async function runPythonAsync(): Promise<number> {
    const pyodide = await loadPyodide()
    console.log(pyodide)
    return await pyodide.runPythonAsync('1+1') as number
}

const workers = {runPythonAsync}

// workerpool passes the resolved value of Promise, not Promise.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type IPyodideWorker = {
    runPythonAsync: (...args: Parameters<typeof runPythonAsync>) => number,
}

workerpool.worker(workers)
