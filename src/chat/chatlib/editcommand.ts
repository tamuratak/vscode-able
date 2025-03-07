import * as vscode from 'vscode'
import { getLocationReferences, getUriRerefences, vscodeFileId, vscodeImplicitSelectionId, vscodeImplicitViewportId, vscodeSelectionId } from './referenceutils.js'


export class EditCommand {

    constructor(readonly extension: {
        readonly outputChannel: vscode.LogOutputChannel
    }) { }

    findTargetFile(request: vscode.ChatRequest): vscode.Uri | undefined {
        const vscodeFiles = getUriRerefences(request).filter(ref => ref.id === vscodeFileId)
        if (vscodeFiles.length === 1) {
            return vscodeFiles[0].value
        } else if (vscodeFiles.length > 1) {
            const message = '#file reference is duplicated. Should not happen.'
            this.extension.outputChannel.error(message)
            throw new Error(message)
        }
        const locationRefs = getLocationReferences(request)
        for (const ref of locationRefs) {
            if ([vscodeImplicitViewportId, vscodeImplicitSelectionId, vscodeSelectionId].includes(ref.id)) {
                const { uri } = ref.value
                return uri
            }
        }
        return undefined
    }

}
