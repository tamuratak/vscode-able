import * as vscode from 'vscode'
import { FileElementProps } from '../promptlib/fsprompts.js'


/** Reference id for user's current visible code, i.e. the uri of the active document and the visible range */
export const vscodeImplicitViewportId = 'vscode.implicit.viewport'

/** Reference id for user's active selection */
export const vscodeImplicitSelectionId = 'vscode.implicit.selection'

/** Reference id for #selection reference*/
export const vscodeSelectionId = 'vscode.selection'

/** Reference id for #file reference*/
export const vscodeFileId = 'vscode.file'


export async function getSelected(request: vscode.ChatRequest) {
    for (const ref of request.references) {
        if ([vscodeSelectionId, vscodeImplicitSelectionId].includes(ref.id)) {
            const { uri, range } = ref.value as { uri: vscode.Uri, range: vscode.Range }
            const doc = await vscode.workspace.openTextDocument(uri)
            return {text: doc.getText(range), uri, range}
        }
    }
    return
}

export async function getAttachmentFiles(request: vscode.ChatRequest): Promise<FileElementProps[]> {
    const result: FileElementProps[] = []
    for (const ref of request.references) {
        if (ref.value instanceof vscode.Uri) {
            const uri = ref.value
            try {
                const buf = await vscode.workspace.fs.readFile(uri)
                const decoder = new TextDecoder()
                const content = decoder.decode(buf)
                result.push({ uri, content })
            } catch {
                // ignore
            }
        }
    }
    return result
}
