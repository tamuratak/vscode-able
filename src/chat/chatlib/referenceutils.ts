import * as vscode from 'vscode'


/** Reference id for user's current visible code, i.e. the uri of the active document and the visible range */
export const vscodeImplicitViewportId = 'vscode.implicit.viewport'

/** Reference id for user's active selection */
export const vscodeImplicitSelectionId = 'vscode.implicit.selection'

/** Reference id for #selection reference*/
export const vscodeSelectionId = 'vscode.selection'

/** Reference id for #file reference*/
export const vscodeFileId = 'vscode.file'

export interface FileReference {
    kind: 'instructions' | 'file'
    uri: vscode.Uri,
    content: string
}

export interface SelectionReference {
    kind: 'explicit' | 'implicit'
    text: string
    uri: vscode.Uri
    range: vscode.Range
}

export async function processReferencesInUserPrompt(references: readonly vscode.ChatPromptReference[]) {
    const files: FileReference[] = []
    const selections: SelectionReference[] = []
    let instructionsText: string | undefined
    for (const ref of references) {
        if (ref.value instanceof vscode.Uri) {
            const uri = ref.value
            try {
                const buf = await vscode.workspace.fs.readFile(uri)
                const decoder = new TextDecoder()
                const content = decoder.decode(buf)
                const kind = ref.id.startsWith('vscode.prompt.instructions') ? 'instructions' : 'file'
                files.push({ uri, content, kind })
            } catch {
                // ignore
            }
        } else if ([vscodeSelectionId, vscodeImplicitSelectionId].includes(ref.id)) {
            const { uri, range } = ref.value as { uri: vscode.Uri, range: vscode.Range }
            const doc = await vscode.workspace.openTextDocument(uri)
            const kind = ref.id === vscodeSelectionId ? 'explicit' : 'implicit'
            selections.push({ text: doc.getText(range), uri, range, kind })
        } else if (ref.id === 'vscode.prompt.instructions.text' && typeof ref.value === 'string') {
            instructionsText = ref.value
            instructionsText = instructionsText.replace('If the file is not already available as attachment, use the #tool:readFile tool to acquire it.\n', '').trim()
        }
    }
    return { files, selections, instructionsText }
}

export async function getSelected(request: vscode.ChatRequest) {
    for (const ref of request.references) {
        if ([vscodeSelectionId, vscodeImplicitSelectionId].includes(ref.id)) {
            const { uri, range } = ref.value as { uri: vscode.Uri, range: vscode.Range }
            const doc = await vscode.workspace.openTextDocument(uri)
            return { text: doc.getText(range), uri, range }
        }
    }
    return
}

export async function getAttachmentFiles(references: readonly vscode.ChatPromptReference[]): Promise<FileReference[]> {
    const result: FileReference[] = []
    for (const ref of references) {
        if (ref.value instanceof vscode.Uri) {
            const uri = ref.value
            try {
                const buf = await vscode.workspace.fs.readFile(uri)
                const decoder = new TextDecoder()
                const content = decoder.decode(buf)
                const kind = ref.id.startsWith('vscode.prompt.instructions') ? 'instructions' : 'file'
                result.push({ uri, content, kind })
            } catch {
                // ignore
            }
        }
    }
    return result
}

export function getInstructionFilesInstruction(request: vscode.ChatRequest): string {
    for (const ref of request.references) {
        if (ref.id === 'vscode.prompt.instructions.text' && typeof ref.value === 'string') {
            let instructions = ref.value
            instructions = instructions.replace('If the file is not already available as attachment, use the #tool:readFile tool to acquire it.\n', '').trim()
            return instructions
        }
    }
    return ''
}
