import * as vscode from 'vscode'
import * as path from 'node:path'

export async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri)
        return true
    } catch {
        return false
    }
}

export async function findWorkspaceFileUri(file: string): Promise<vscode.Uri | undefined> {
    const uri = toUri(file)
    if (!uri) {
        const folders = vscode.workspace.workspaceFolders
        if (folders) {
            for (const folder of folders) {
                const workspaceFile = vscode.Uri.joinPath(folder.uri, file)
                if (await exists(workspaceFile)) {
                    return workspaceFile
                }
            }
        }
    } else if (await exists(uri)) {
        return uri
    }
    return undefined
}

export function toUri(file: string): vscode.Uri | undefined {
    let uri: vscode.Uri | undefined
    try {
        uri = vscode.Uri.parse(file)
        return uri
    } catch { }
    if (path.isAbsolute(file)) {
        try {
            uri = vscode.Uri.file(file)
        } catch { }
    }
    return uri
}
