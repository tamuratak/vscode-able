import * as vscode from 'vscode'
import { EditPrompt, FluentJaPrompt, FluentPrompt, HistoryEntry, InputProps, SimplePrompt, ToEnPrompt, ToJaPrompt } from './prompt.js'
import { type PromptElementCtor } from '@vscode/prompt-tsx'
import { extractAbleHistory, getSelectedText } from './chatlib/utils.js'
import { OpenAiApiChatHandler } from './chatlib/openaichathandler.js'
import { CopilotChatHandler } from './chatlib/copilotchathandler.js'


export type RequestCommands = 'fluent' | 'fluent_ja' | 'to_en' | 'to_ja'

enum ChatVendor {
    Copilot = 'copilot',
    OpenAiApi = 'openai_api',
}

class ChatSession {
    readonly vscodeImplicitViewport?: { uri: vscode.Uri, range?: vscode.Range | undefined }
    readonly references: readonly vscode.ChatPromptReference[]
    readonly prompt: string

    constructor(request: vscode.ChatRequest) {
        this.references = request.references
        this.prompt = request.prompt
        const vscodeImplicitViewport = request.references.find(ref => ref.id === 'vscode.implicit.viewport')
        if (vscodeImplicitViewport) {
            let uri: vscode.Uri | undefined
            let range: vscode.Range | undefined
            if (vscodeImplicitViewport.value instanceof vscode.Uri) {
                uri = vscodeImplicitViewport.value
            } else if (vscodeImplicitViewport.value instanceof vscode.Location) {
                uri = vscodeImplicitViewport.value.uri
                range = vscodeImplicitViewport.value.range
            } else if (typeof vscodeImplicitViewport.value === 'string') {
                uri = vscode.Uri.parse(vscodeImplicitViewport.value)
            }
            if (uri) {
                this.vscodeImplicitViewport = { uri, range }
            }
        }
    }
}

export class ChatHandleManager {
    private vendor = ChatVendor.Copilot
    readonly outputChannel = vscode.window.createOutputChannel('vscode-able-chat', { log: true })
    private readonly copilotChatHandler: CopilotChatHandler
    private readonly openaiApiChatHandler: OpenAiApiChatHandler
    private chatSession: ChatSession | undefined

    constructor(public readonly openAiServiceId: string) {
        this.copilotChatHandler = new CopilotChatHandler(this.outputChannel)
        this.openaiApiChatHandler = new OpenAiApiChatHandler(openAiServiceId, this.outputChannel)
        this.outputChannel.info('ChatHandleManager initialized')
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
            this.outputChannel.info('Successfully loaded the GPT-4o Mini model.')
        } else {
            const message = 'Failed to load GPT-4o Mini model.'
            void vscode.window.showErrorMessage(message)
            this.outputChannel.error(message)
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
            } else if (selection.label === 'openai-gpt-4o-mini') {
                this.vendor = ChatVendor.OpenAiApi
                await this.openaiApiChatHandler.resolveOpenAiClient()
            } else {
                throw new Error('should not reach here')
            }
            this.outputChannel.info(`Model selected: ${selection.label}`)
        } catch (error) {
            if (error instanceof Error) {
                this.outputChannel.error(error)
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
                this.outputChannel.info(JSON.stringify(request.references))
                this.chatSession = new ChatSession(request)
                const ableHistory = extractAbleHistory(context)
                if (request.command === 'edit') {
                    const uri = this.chatSession.vscodeImplicitViewport?.uri
                    if (uri) {
                        const document = await vscode.workspace.openTextDocument(uri)
                        await this.copilotChatHandler.copilotChatResponse(token, request, EditPrompt, { history: ableHistory, input: request.prompt, uri: uri.toString(), content: document.getText() }, stream)
                    }
                    return
                } else if (request.command === 'fluent') {
                    const response = await this.responseWithSelection(token, request, FluentPrompt, ableHistory)
                    stream.markdown(response)
                    return
                } else if (request.command === 'fluent_ja') {
                    const response = await this.responseWithSelection(token, request, FluentJaPrompt, ableHistory)
                    stream.markdown(response)
                    return
                } if (request.command === 'to_en') {
                    const response = await this.responseWithSelection(token, request, ToEnPrompt, ableHistory)
                    stream.markdown(response)
                    return
                } else if (request.command === 'to_ja') {
                    const response = await this.responseWithSelection(token, request, ToJaPrompt, ableHistory)
                    stream.markdown(response)
                    return
                } else {
                    if (this.vendor === ChatVendor.Copilot) {
                        await this.copilotChatHandler.copilotChatResponse(token, request, SimplePrompt, { history: ableHistory, input: request.prompt }, stream, request.model)
                    } else {
                        await this.openaiApiChatHandler.openAiGpt4oMiniResponse(token, request, SimplePrompt, ableHistory, stream)
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
        ctor: PromptElementCtor<InputProps, S>,
        ableHistory: HistoryEntry[],
        stream?: vscode.ChatResponseStream,
        model?: vscode.LanguageModelChat,
    ) {
        const selectedText = await getSelectedText(request)
        const input = selectedText ?? request.prompt
        let responseText = ''
        if (this.vendor === ChatVendor.Copilot) {
            const { chatResponse } = await this.copilotChatHandler.copilotChatResponse(token, request, ctor, { history: ableHistory, input: request.prompt }, stream, model)
            if (chatResponse) {
                for await (const fragment of chatResponse.text) {
                    responseText += fragment
                }
            }
        } else {
            const { chatResponse } = await this.openaiApiChatHandler.openAiGpt4oMiniResponse(token, request, ctor, ableHistory, stream)
            if (chatResponse) {
                for await (const fragment of chatResponse) {
                    responseText += fragment.choices[0]?.delta?.content ?? ''
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
