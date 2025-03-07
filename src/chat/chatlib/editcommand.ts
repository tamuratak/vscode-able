import * as vscode from 'vscode'
import { vscodeFileId, vscodeImplicitSelectionId, vscodeImplicitViewportId, vscodeSelectionId } from './referenceutils.js'


export class EditCommand {

    constructor(readonly extension: {
        readonly outputChannel: vscode.LogOutputChannel
    }) { }

    findTargetFile(request: vscode.ChatRequest): vscode.Uri | undefined {
        const vscodeFiles = request.references.filter(ref => ref.id === vscodeFileId)
        if (vscodeFiles.length > 1) {
            const message = '#file reference is duplicated. Should not happen.'
            this.extension.outputChannel.error(message)
            throw new Error(message)
        }
        for (const ref of vscodeFiles) {
            return ref.value as vscode.Uri
        }
        for (const ref of request.references) {
            if ([vscodeImplicitViewportId, vscodeImplicitSelectionId, vscodeSelectionId].includes(ref.id)) {
                const { uri } = ref.value as { uri: vscode.Uri }
                return uri
            }
        }
        return undefined
    }

}
