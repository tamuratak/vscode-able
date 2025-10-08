import * as vscode from 'vscode'

export function debugObj(msg: string, obj: unknown, outputChannel: vscode.LogOutputChannel) {
    const logLevels = [vscode.LogLevel.Debug, vscode.LogLevel.Trace]
    if (logLevels.includes(vscode.env.logLevel)) {
        outputChannel.debug(msg + JSON.stringify(obj, null, 2))
    }
}
