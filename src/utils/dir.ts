import * as vscode from 'vscode'

export interface DirEntry {
    name: string
    fileType: vscode.FileType
    uri: vscode.Uri
}
