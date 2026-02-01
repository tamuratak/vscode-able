import * as vscode from 'vscode'
import { AskChatPrompt } from './prompt.js'
import { CopilotChatHandler } from './chatlib/copilotchathandler.js'
import { processReferencesInUserPrompt } from './chatlib/referenceutils.js'


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
            const { files, selections,instructionsText } = await processReferencesInUserPrompt(request.references)
            const instructionFiles = files.filter(ref => ref.kind === 'instructions')
            const attachments = files.filter(ref => ref.kind === 'file')
            const modeInstruction = request.modeInstructions2?.content
            await this.copilotChatHandler.copilotChatResponse(
                token,
                AskChatPrompt,
                { input: request.prompt, history: context.history, attachments, selections, instructionFiles, instructionsText, modeInstruction },
                request.model,
                stream
            )
            return
        }
    }
}
