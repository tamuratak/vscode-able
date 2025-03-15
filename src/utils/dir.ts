import * as vscode from 'vscode'

export interface DirEntry {
    name: string
    fileType: vscode.FileType
    uri: vscode.Uri
}

export async function readDir(dirUri: vscode.Uri): Promise<DirEntry[]> {
    return vscode.workspace.fs.readDirectory(dirUri).then(entries => {
        return entries.map(([name, fileType]) => {
            const childUri = vscode.Uri.joinPath(dirUri, name)
            return { name, fileType, uri: childUri }
        })
    })
}
