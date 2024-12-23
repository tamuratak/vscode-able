/**
 * A WebWorker entrypoint that uses comlink to handle postMessage details
 */

import { expose } from 'comlink'
import { IPyodideWorkerKernel } from './tokens.js'
import { PyodideRemoteKernel } from './worker.js'
import nodeEndpoint from 'comlink/dist/umd/node-adapter'
import { parentPort } from 'node:worker_threads'
import { SyncMessaging } from './syncmessagingworker.js'


export class PyodideComlinkKernel extends PyodideRemoteKernel {
    /**
     * Setup custom Emscripten FileSystem
     */
    protected override async initFilesystem(options: IPyodideWorkerKernel.IOptions): Promise<void> {
        if (options.mountDrive && this._localPath) {
            const { FS } = this._pyodide
            const mountDir = this._localPath
            FS.mkdirTree(mountDir)
            FS.mount(FS.filesystems.NODEFS, { root: mountDir }, mountDir)
            this._driveFS = FS.filesystems.NODEFS
        }
    }
}

parentPort!.once('message', (msg: any) => {
    const worker = new PyodideComlinkKernel(new SyncMessaging(msg))
    expose(worker, nodeEndpoint(parentPort!))
})
