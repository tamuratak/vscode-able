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
    private vendor = ChatVendor.Copilot

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

    async quickPickModel() {
        try {
            const models = await vscode.lm.selectChatModels({ vendor: 'copilot' })
            if (models.length === 0) {
                void vscode.window.showErrorMessage('No Copilot chat models found.')
                return
            }
            const generatedItems = models.map(model => ({ label: model.family, model }))
            const items = [{ label: 'openai-gpt-4o-mini', model: undefined }, ...generatedItems]

            const quickPick = vscode.window.createQuickPick<typeof items[0]>()
            quickPick.items = items
            quickPick.placeholder = 'Select chat model'
            if (this.copilotChatHandler.copilotModelFamily) {
                quickPick.activeItems = items.filter(i => i.label === this.copilotChatHandler.copilotModelFamily)
            }

            const selectionPromise = new Promise<typeof items[0] | undefined>((resolve) => {
                quickPick.onDidAccept(() => {
                    resolve(quickPick.selectedItems[0])
                    quickPick.hide()
                })
                quickPick.onDidHide(() => {
                    resolve(undefined)
                })
            })
            quickPick.show()

            const selection = await selectionPromise
            if (!selection) {
                return
            }
            if (selection.model) {
                this.vendor = ChatVendor.Copilot
                this.copilotChatHandler.copilotModelFamily = selection.label
            } else {
                throw new Error('should not reach here')
            }
            this.extension.outputChannel.info(`Model selected: ${selection.label}`)
        } catch (error) {
            if (error instanceof Error) {
                this.extension.outputChannel.error(error)
            }
            void vscode.window.showErrorMessage('Failed to select chat model.')
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
                        stream,
                        request.model,
                        [],
                    )
                } else if (request.command === 'fluent') {
                    const response = await this.responseWithSelection(token, request, FluentPrompt, history)
                    stream.markdown(response)
                    return
                } else if (request.command === 'fluent_ja') {
                    const response = await this.responseWithSelection(token, request, FluentJaPrompt, history)
                    stream.markdown(response)
                    return
                } else if (request.command === 'to_en') {
                    const response = await this.responseWithSelection(token, request, ToEnPrompt, history)
                    stream.markdown(response)
                    return
                } else if (request.command === 'to_ja') {
                    const response = await this.responseWithSelection(token, request, ToJaPrompt, history)
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
                            stream,
                            request.model,
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
        stream?: vscode.ChatResponseStream,
        model?: vscode.LanguageModelChat,
    ) {
        const selectedText = await getSelectedText(request)
        const input = selectedText ?? request.prompt
        let responseText = ''
        if (this.vendor === ChatVendor.Copilot) {
            const ret = await this.copilotChatHandler.copilotChatResponse(token, request, ctor, { history: ableHistory, input }, stream, model)
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
