import * as vscode from 'vscode'
import { AskChatPrompt } from './prompt.js'
import { CopilotChatHandler } from './chatlib/copilotchathandler.js'
import { getAttachmentFiles, getInstructionFilesInstruction } from './chatlib/referenceutils.js'
import { debugObj } from '../utils/debug.js'


export class AskChatHandleManager {
    private readonly copilotChatHandler: CopilotChatHandler

    constructor(
        private readonly extension: {
            readonly outputChannel: vscode.LogOutputChannel,
        }
    ) {
        this.copilotChatHandler = new CopilotChatHandler(extension)
    }

    getHandler(): vscode.ChatRequestHandler {
        return async (
            request: vscode.ChatRequest,
            _context: vscode.ChatContext,
            stream: vscode.ChatResponseStream,
            token: vscode.CancellationToken
        ): Promise<vscode.ChatResult | undefined> => {
            debugObj('[Able Chat] request.references: ', request.references, this.extension.outputChannel)

            const references = await getAttachmentFiles(request)
            const instructionFiles = references.filter(ref => ref.kind === 'instructions')
            const attachments = references.filter(ref => ref.kind === 'file')
            const instructionFilesInstruction = getInstructionFilesInstruction(request)
            const modeInstruction = request.modeInstructions2?.content
            await this.copilotChatHandler.copilotChatResponse(
                token,
                AskChatPrompt,
                { input: request.prompt, attachments, instructionFiles, instructionFilesInstruction, modeInstruction },
                request.model,
                stream
            )
            return
        }
    }
}
