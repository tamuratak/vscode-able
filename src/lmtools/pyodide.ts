import * as path from 'node:path'
import * as workerpool from 'workerpool'
import { IPyodideWorker } from './pyodidelib/pyodide_worker.js'

const pool = workerpool.pool(
    path.join(__dirname, 'mathjaxpool_worker.js'),
    { minWorkers: 1, maxWorkers: 1, workerType: 'thread' }
)
export const proxyPromise = pool.proxy<IPyodideWorker>()
