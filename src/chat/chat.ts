import * as vscode from 'vscode'
import { FluentJaPrompt, FluentPrompt, HistoryEntry, MainPromptProps, PlanPrompt, SimplePrompt, ToEnPrompt, ToJaPrompt } from './prompt.js'
import type { PromptElementCtor } from '@vscode/prompt-tsx'
import { convertHistory } from './chatlib/historyutils.js'
import { CopilotChatHandler } from './chatlib/copilotchathandler.js'
import { getAttachmentFiles, getSelected } from './chatlib/referenceutils.js'


export type RequestCommands = 'fluent' | 'fluent_ja' | 'to_en' | 'to_ja'

class ChatSession {
    readonly references: readonly vscode.ChatPromptReference[]
    readonly prompt: string

    constructor(request: vscode.ChatRequest) {
        this.references = request.references
        this.prompt = request.prompt
    }

}

export class ChatHandleManager {
    private readonly copilotChatHandler: CopilotChatHandler
    private chatSession: ChatSession | undefined

    constructor(
        private readonly extension: {
            readonly outputChannel: vscode.LogOutputChannel,
        }
    ) {
        this.copilotChatHandler = new CopilotChatHandler(extension)
        this.extension.outputChannel.info('ChatHandleManager initialized')
    }

    getChatSession() {
        return this.chatSession
    }

    getHandler(): vscode.ChatRequestHandler {
        return async (
            request: vscode.ChatRequest,
            context: vscode.ChatContext,
            stream: vscode.ChatResponseStream,
            token: vscode.CancellationToken
        ): Promise<vscode.ChatResult | undefined> => {
            try {
                this.extension.outputChannel.debug(JSON.stringify(request.references))
                this.chatSession = new ChatSession(request)
                const history = convertHistory(context)
                if (request.command === 'plan') {
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
                    return
                } else if (request.command === 'fluent') {
                    return await this.responseWithSelection(token, request, FluentPrompt, history, request.model, stream)
                } else if (request.command === 'fluent_ja') {
                    return await this.responseWithSelection(token, request, FluentJaPrompt, history, request.model, stream)
                } else if (request.command === 'to_en') {
                    return await this.responseWithSelection(token, request, ToEnPrompt, history, request.model, stream)
                } else if (request.command === 'to_ja') {
                    return await this.responseWithSelection(token, request, ToJaPrompt, history, request.model, stream)
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
                    return
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
        stream: vscode.ChatResponseStream,
    ): Promise<vscode.ChatResult | undefined> {
        const selected = await getSelected(request)
        const input = selected?.text ?? request.prompt
        let responseText = ''
        const userInstruction = selected ? request.prompt : undefined
        const ret = await this.copilotChatHandler.copilotChatResponse(token, request, ctor, { history: ableHistory, input, userInstruction }, model)
        if (ret?.chatResponse) {
            for await (const fragment of ret.chatResponse.text) {
                responseText += fragment
            }
        }
        if (selected) {
            const formattedChatOutput = '#### input\n' + input + '\n\n' + '#### output\n' + responseText
            stream.markdown(formattedChatOutput)
            const edit = new vscode.TextEdit(selected.range, responseText)
            const uri = selected.uri
            stream.textEdit(uri, edit)
            return { metadata: { input, output: responseText } }
        } else {
            stream.markdown(responseText)
            return
        }
    }

}
