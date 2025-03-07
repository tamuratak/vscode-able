import * as vscode from 'vscode'


/** Reference id for user's current visible code, i.e. the uri of the active document and the visible range */
export const vscodeImplicitViewportId = 'vscode.implicit.viewport'

/** Reference id for user's active selection */
export const vscodeImplicitSelectionId = 'vscode.implicit.selection'

/** Reference id for #selection reference*/
export const vscodeSelectionId = 'vscode.selection'

/** Reference id for #file reference*/
export const vscodeFileId = 'vscode.file'


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
