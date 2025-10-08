import * as vscode from 'vscode'

export function debugObj(msg: string, obj: unknown, outputChannel: vscode.LogOutputChannel) {
    if (isLoggingActive(vscode.LogLevel.Debug)) {
        outputChannel.debug(msg + JSON.stringify(obj, null, 2))
    }
}

export function isLoggingActive(level: vscode.LogLevel): boolean {
    if (vscode.env.logLevel !== vscode.LogLevel.Off) {
        return vscode.env.logLevel <= level
    }
    return false
}
