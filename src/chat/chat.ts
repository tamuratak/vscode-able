import * as vscode from 'vscode'
import { FluentJaPrompt, FluentPrompt, HistoryEntry, MainPromptProps, PlanPrompt, SimplePrompt, ToEnPrompt, ToJaPrompt } from './prompt.js'
import type { PromptElementCtor } from '@vscode/prompt-tsx'
import { convertHistory } from './chatlib/historyutils.js'
import { CopilotChatHandler } from './chatlib/copilotchathandler.js'
import type { EditTool } from '../lmtools/edit.js'
import { getAttachmentFiles, getSelectedText } from './chatlib/referenceutils.js'
import { EditCommand } from './chatlib/editcommand.js'


export type RequestCommands = 'fluent' | 'fluent_ja' | 'to_en' | 'to_ja'

enum ChatVendor {
    Copilot = 'copilot',
    OpenAiApi = 'openai_api',
}

class ChatSession {
    readonly references: readonly vscode.ChatPromptReference[]
    readonly prompt: string

    constructor(request: vscode.ChatRequest) {
        this.references = request.references
        this.prompt = request.prompt
    }

}

export class ChatHandleManager {
    private readonly vendor = ChatVendor.Copilot

    private readonly copilotChatHandler: CopilotChatHandler
    private chatSession: ChatSession | undefined
    private readonly editCommand: EditCommand

    constructor(
        private readonly extension: {
            readonly outputChannel: vscode.LogOutputChannel,
            readonly editTool: EditTool
        }
    ) {
        this.copilotChatHandler = new CopilotChatHandler(extension)
        this.editCommand = new EditCommand({ ...extension, copilotChatHandler: this.copilotChatHandler })
        this.extension.outputChannel.info('ChatHandleManager initialized')
    }

    getChatSession() {
        return this.chatSession
    }

    async initGpt4oMini() {
        const [mini,] = await vscode.lm.selectChatModels({
            vendor: 'copilot',
            family: 'gpt-4o-mini'
        })
        if (mini) {
            this.extension.outputChannel.info('Successfully loaded the GPT-4o Mini model.')
        } else {
            const message = 'Failed to load GPT-4o Mini model.'
            void vscode.window.showErrorMessage(message)
            this.extension.outputChannel.error(message)
        }
    }

    getHandler(): vscode.ChatRequestHandler {
        return async (
            request: vscode.ChatRequest,
            context: vscode.ChatContext,
            stream: vscode.ChatResponseStream,
            token: vscode.CancellationToken
        ) => {
            try {
                this.extension.outputChannel.debug(JSON.stringify(request.references))
                this.chatSession = new ChatSession(request)
                const history = convertHistory(context)
                if (request.command === 'edit') {
                    return await this.editCommand.runEditCommand(request, token, stream, history)
                } else if (request.command === 'plan') {
                    const attachments = await getAttachmentFiles(request)
                    await this.copilotChatHandler.copilotChatResponse(
                        token,
                        request,
                        PlanPrompt,
                        { history, input: request.prompt, attachments },
                        request.model,
                        stream,
                        [],
                    )
                } else if (request.command === 'fluent') {
                    const response = await this.responseWithSelection(token, request, FluentPrompt, history, request.model)
                    stream.markdown(response)
                    return
                } else if (request.command === 'fluent_ja') {
                    const response = await this.responseWithSelection(token, request, FluentJaPrompt, history, request.model)
                    stream.markdown(response)
                    return
                } else if (request.command === 'to_en') {
                    const response = await this.responseWithSelection(token, request, ToEnPrompt, history, request.model)
                    stream.markdown(response)
                    return
                } else if (request.command === 'to_ja') {
                    const response = await this.responseWithSelection(token, request, ToJaPrompt, history, request.model)
                    stream.markdown(response)
                    return
                } else if (request.command === 'experiment') {
                    stream.markdown('This is an experimental feature. Please wait for further updates.')
                    const edit = new vscode.TextEdit(
                        new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
                        'This is an experimental feature. Please wait for further updates.'
                    )
                    const uri = vscode.window.activeTextEditor?.document.uri
                    if (uri) {
                        stream.textEdit(uri, edit)
                    }
                    return
                } else {
                    if (this.vendor === ChatVendor.Copilot) {
                        const attachments = await getAttachmentFiles(request)
                        await this.copilotChatHandler.copilotChatResponse(
                            token,
                            request,
                            SimplePrompt,
                            { history, input: request.prompt, attachments },
                            request.model,
                            stream,
                            [],
                        )
                    }
                }
            } finally {
                this.chatSession = undefined
            }
        }
    }

    private async responseWithSelection<S>(
        token: vscode.CancellationToken,
        request: vscode.ChatRequest,
        ctor: PromptElementCtor<MainPromptProps, S>,
        ableHistory: HistoryEntry[],
        model: vscode.LanguageModelChat,
        stream?: vscode.ChatResponseStream,
    ) {
        const selectedText = await getSelectedText(request)
        const input = selectedText ?? request.prompt
        let responseText = ''
        if (this.vendor === ChatVendor.Copilot) {
            const ret = await this.copilotChatHandler.copilotChatResponse(token, request, ctor, { history: ableHistory, input }, model, stream)
            if (ret?.chatResponse) {
                for await (const fragment of ret.chatResponse.text) {
                    responseText += fragment
                }
            }
        }
        if (selectedText) {
            return '#### input\n' + input + '\n\n' + '#### output\n' + responseText
        } else {
            return responseText
        }
    }

}
