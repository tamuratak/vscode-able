import * as vscode from 'vscode'
import { inspectReadable } from './inspect.js'

export function debugObj(
    msg: string,
    obj: unknown,
    outputChannel: vscode.LogOutputChannel
) {
    if (obj instanceof Function) {
        const result = obj.call(undefined) as unknown
        if (result instanceof Promise) {
            void result.then((r) => {
                outputChannel.info(msg + r)
            })
        } else {
            outputChannel.info(msg, [result])
        }
    } else {
        outputChannel.info(msg + inspectReadable(obj))
    }
}
