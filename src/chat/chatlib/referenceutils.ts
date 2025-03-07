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

interface UriReference extends vscode.ChatPromptReference {
    value: vscode.Uri
}

export function getUriRerefences(request: vscode.ChatRequest) {
    const refs: UriReference[] = []
    for (const ref of request.references) {
        if (ref.value instanceof vscode.Uri) {
            const value = ref.value
            refs.push({...ref, value})

        }
    }
    return refs
}

interface LocationReference extends vscode.ChatPromptReference {
    value: vscode.Location
}

export function getLocationReferences(request: vscode.ChatRequest) {
    const refs: LocationReference[] = []
    for (const ref of request.references) {
        if (ref.value instanceof vscode.Location) {
            const value = ref.value
            refs.push({...ref, value})
        }
    }
    return refs
}
