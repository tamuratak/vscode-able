import * as vscode from 'vscode'
import { vscodeImplicitSelectionId } from './constants.js'


export async function getSelectedText(request: vscode.ChatRequest) {
    for (const ref of request.references) {
        if (ref.id === vscodeImplicitSelectionId) {
            const { uri, range } = ref.value as { uri: vscode.Uri, range: vscode.Range }
            const doc = await vscode.workspace.openTextDocument(uri)
            return doc.getText(range)
        }
    }
    return
}
