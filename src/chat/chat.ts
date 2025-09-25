import * as vscode from 'vscode'
import { FluentJaPrompt, FluentPrompt, MainPromptProps, SimplePrompt, ToEnPrompt, ToJaPrompt } from './prompt.js'
import type { PromptElementCtor } from '@vscode/prompt-tsx'
import { extractHitory } from './chatlib/historyutils.js'
import { CopilotChatHandler } from './chatlib/copilotchathandler.js'
import { getAttachmentFiles, getSelected } from './chatlib/referenceutils.js'
import { AbleChatResultMetadata } from './chatlib/chatresultmetadata.js'
import { debugObj } from '../utils/debug.js'
import { convertMathEnv, removeLabel } from './chatlib/latex.js'
import { toCunks } from './chatlib/chunk.js'


export type RequestCommands = 'fluent' | 'fluent_ja' | 'to_en' | 'to_ja'

export class ChatHandleManager {
    private readonly copilotChatHandler: CopilotChatHandler

    constructor(
        private readonly extension: {
            readonly outputChannel: vscode.LogOutputChannel,
        }
    ) {
        this.copilotChatHandler = new CopilotChatHandler(extension)
        this.extension.outputChannel.info('ChatHandleManager initialized')
    }

    getHandler(): vscode.ChatRequestHandler {
        return async (
            request: vscode.ChatRequest,
            context: vscode.ChatContext,
            stream: vscode.ChatResponseStream,
            token: vscode.CancellationToken
        ): Promise<vscode.ChatResult | undefined> => {
            debugObj('[Able Chat] request.references: ', request.references, this.extension.outputChannel)
            const history = extractHitory(context)
            if (request.command) {
                return this.responseForCommand(token, request, stream)
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
        }
    }

    private async responseForCommand(
        token: vscode.CancellationToken,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
    ): Promise<vscode.ChatResult | undefined> {
        const model = request.model
        let ctor: PromptElementCtor<MainPromptProps, unknown> | undefined
        if (request.command === 'fluent') {
            ctor = FluentPrompt
        } else if (request.command === 'fluent_ja') {
            ctor = FluentJaPrompt
        } else if (request.command === 'to_en') {
            ctor = ToEnPrompt
        } else if (request.command === 'to_ja') {
            ctor = ToJaPrompt
        }
        if (!ctor) {
            this.extension.outputChannel.error(`Unknown command: ${request.command}`)
            return
        }
        const selected = await getSelected(request)
        const input = selected?.text ?? request.prompt
        let responseText = ''
        const userInstruction = selected ? request.prompt : undefined
        const chunks = toCunks(input, 1024)
        for (const inputChunk of chunks) {
            const ret = await this.copilotChatHandler.copilotChatResponse(token, request, ctor, { input: inputChunk, userInstruction }, model)
            let responseChunk = ''
            if (ret?.chatResponse) {
                for await (const fragment of ret.chatResponse.text) {
                    responseChunk += fragment
                }
            }
            if (selected) {
                const formattedChatOutput = '#### input\n' + this.tweakResponse(inputChunk) + '\n\n' + '#### output\n' + this.tweakResponse(responseChunk) + '\n\n'
                stream.markdown(formattedChatOutput)
            } else {
                stream.markdown(responseChunk)
                stream.markdown('\n\n')
            }
            responseText += responseChunk + '\n\n'
        }
        if (selected) {
            const edit = new vscode.TextEdit(selected.range, responseText)
            const uri = selected.uri
            stream.textEdit(uri, edit)
            return { metadata: { input, output: responseText, selected, userInstruction } } satisfies { metadata: AbleChatResultMetadata }
        }
        return
    }

    private tweakResponse(text: string): string {
        text = convertMathEnv(text)
        text = removeLabel(text)
        return text
    }

}
