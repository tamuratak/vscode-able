import * as vscode from 'vscode'
import { SimplePrompt } from './prompt.js'
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

            const attachments = await getAttachmentFiles(request)
            const instructionFilesInstruction = getInstructionFilesInstruction(request)
            const modeInstruction = request.modeInstructions2?.content
            await this.copilotChatHandler.copilotChatResponse(
                token,
                SimplePrompt,
                { input: request.prompt, attachments, instructionFilesInstruction, modeInstruction },
                request.model,
                stream
            )
            return
        }
    }
}
