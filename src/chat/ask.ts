import * as vscode from 'vscode'
import { AskChatPrompt } from './prompt.js'
import { CopilotChatHandler } from './chatlib/copilotchathandler.js'
import { getAttachmentFiles, getInstructionFilesInstruction } from './chatlib/referenceutils.js'


export class AskChatHandleManager {
    private readonly copilotChatHandler: CopilotChatHandler

    constructor(
        extension: {
            readonly outputChannel: vscode.LogOutputChannel,
        }
    ) {
        this.copilotChatHandler = new CopilotChatHandler(extension)
    }

    getHandler(): vscode.ChatRequestHandler {
        return async (
            request: vscode.ChatRequest,
            context: vscode.ChatContext,
            stream: vscode.ChatResponseStream,
            token: vscode.CancellationToken
        ): Promise<vscode.ChatResult | undefined> => {
            const history = context.history.slice(1) // remove system prompt
            const references = await getAttachmentFiles(request)
            const instructionFiles = references.filter(ref => ref.kind === 'instructions')
            const attachments = references.filter(ref => ref.kind === 'file')
            const instructionFilesInstruction = getInstructionFilesInstruction(request)
            const modeInstruction = request.modeInstructions2?.content
            await this.copilotChatHandler.copilotChatResponse(
                token,
                AskChatPrompt,
                { input: request.prompt, history, attachments, instructionFiles, instructionFilesInstruction, modeInstruction },
                request.model,
                stream
            )
            return
        }
    }
}
