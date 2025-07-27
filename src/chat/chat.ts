import * as vscode from 'vscode'
import { FluentJaPrompt, FluentPrompt, GenerateCommitMessagePrompt, HistoryEntry, MainPromptProps, SimplePrompt, ToEnPrompt, ToJaPrompt } from './prompt.js'
import type { PromptElementCtor } from '@vscode/prompt-tsx'
import { extractAbleCommandHistory, extractHitory } from './chatlib/historyutils.js'
import { CopilotChatHandler } from './chatlib/copilotchathandler.js'
import { getAttachmentFiles, getSelected } from './chatlib/referenceutils.js'
import { AbleChatResultMetadata } from './chatlib/chatresultmetadata.js'
import type { ExternalPromise } from '../utils/externalpromise.js'
import type { GitExtension } from '../../types/git/git.js'
import { getWorkspaceGitDiff } from '../utils/git.js'


export type RequestCommands = 'fluent' | 'fluent_ja' | 'to_en' | 'to_ja'

export class ChatHandleManager {
    private readonly copilotChatHandler: CopilotChatHandler

    constructor(
        private readonly extension: {
            readonly outputChannel: vscode.LogOutputChannel,
            readonly gitExtension: ExternalPromise<GitExtension | undefined>
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
            this.extension.outputChannel.debug(JSON.stringify(request.references))
            const ableCommandHistory = extractAbleCommandHistory(context)
            const history = extractHitory(context)
            if (request.command === 'fluent') {
                return this.responseWithSelection(token, request, FluentPrompt, ableCommandHistory, request.model, stream)
            } else if (request.command === 'fluent_ja') {
                return this.responseWithSelection(token, request, FluentJaPrompt, ableCommandHistory, request.model, stream)
            } else if (request.command === 'to_en') {
                return this.responseWithSelection(token, request, ToEnPrompt, ableCommandHistory, request.model, stream)
            } else if (request.command === 'to_ja') {
                return this.responseWithSelection(token, request, ToJaPrompt, ableCommandHistory, request.model, stream)
            } else if (request.command === 'commit_message') {
                const gitExtension = await this.extension.gitExtension.promise
                if (!gitExtension) {
                    stream.markdown('Git extension is not available.')
                    return
                }
                const diff = await getWorkspaceGitDiff(gitExtension)
                if (!diff) {
                    stream.markdown('No git diff available.')
                    return
                }
                await this.copilotChatHandler.copilotChatResponse(
                    token,
                    request,
                    GenerateCommitMessagePrompt,
                    { history, input: diff, userInstruction: request.prompt },
                    request.model,
                    stream,
                    [],
                )
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
            return { metadata: { input, output: responseText, selected, userInstruction } } satisfies { metadata: AbleChatResultMetadata }
        } else {
            stream.markdown(responseText)
            return
        }
    }

}
