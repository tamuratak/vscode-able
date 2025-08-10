import * as vscode from 'vscode'

export function debugObj(msg: string, obj: unknown, outputChannel: vscode.LogOutputChannel) {
    const logLevels = [vscode.LogLevel.Trace, vscode.LogLevel.Debug]
    if (logLevels.includes(outputChannel.logLevel)) {
        outputChannel.debug(msg + JSON.stringify(obj, null, 2))
    }
}
