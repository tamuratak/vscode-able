import * as vscode from 'vscode'
import { getLocationReferences, getUriRerefences, vscodeFileId, vscodeImplicitSelectionId, vscodeImplicitViewportId, vscodeSelectionId } from './referenceutils.js'
import type { CopilotChatHandler } from './copilotchathandler.js'
import { EditPrompt, type HistoryEntry } from '../prompt.js'


export class EditCommand {

    constructor(readonly extension: {
        readonly outputChannel: vscode.LogOutputChannel
        readonly copilotChatHandler: CopilotChatHandler
    }) { }

    /**
     * If a #file reference exists, it serves as the target file to be edited; otherwise, an implicit file reference is selected as the target file.
     */
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

    async runEditCommand(request: vscode.ChatRequest, token: vscode.CancellationToken, stream: vscode.ChatResponseStream, history: HistoryEntry[]) {
        const uri = this.findTargetFile(request)
        if (uri) {
            const document = await vscode.workspace.openTextDocument(uri)
            await this.extension.copilotChatHandler.copilotChatResponse(
                token,
                request,
                EditPrompt,
                {
                    history,
                    input: request.prompt,
                    target: {
                        uri,
                        content: document.getText()
                    }
                },
                stream,
                request.model
            )
        }
    }

}
