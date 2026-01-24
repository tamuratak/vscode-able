import * as vscode from 'vscode'
import { CancellationToken, LanguageModelChatMessage, ProvideLanguageModelChatResponseOptions, Progress, LanguageModelChatInformation, LanguageModelChatProvider } from 'vscode'
import { debugObj } from '../utils/debug.js'
import { renderMessageContent, renderMessages, renderMessageWithTag } from '../utils/renderer.js'
import { tokenLength } from './chatproviderlib/openaicompatchatproviderlib/tokencount.js'
import { exucuteGeminiCliCommand } from '../utils/geminicli.js'
import { Attachment, extractAttachments, tweakUserPrompt } from './geminiclilib/utils.js'


export class GeminiCliChatProvider implements LanguageModelChatProvider<LanguageModelChatInformation> {
    private readonly aiModelIds = [
        ['gemini-3-pro-preview', 'Gemini 3 Pro'],
        ['gemini-3-flash-preview', 'Gemini 3 Flash'],
        ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
        ['gemini-2.5-flash', 'Gemini 2.5 Flash'],
        ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite']
    ] as const

    constructor(
        private readonly extension: {
            readonly outputChannel: vscode.LogOutputChannel,
        }
    ) {
        this.extension.outputChannel.info('Gemini CLI chat provider initialized')
    }

    provideLanguageModelChatInformation(): LanguageModelChatInformation[] {
        const result: LanguageModelChatInformation[] = []
        for (const [modelId, displayName] of this.aiModelIds) {
            result.push({
                id: modelId,
                category: {
                    label: 'Gemini CLI (with Able)',
                    order: 1000
                },
                detail: 'Able',
                name: displayName,
                family: modelId,
                version: modelId,
                maxInputTokens: 1048576,
                maxOutputTokens: 65536,
                tooltip: 'Gemini CLI',
                requiresAuthorization: true,
                capabilities: {
                    toolCalling: true,
                    imageInput: false
                },
            })
        }
        return result
    }

    async provideLanguageModelChatResponse(
        model: LanguageModelChatInformation,
        messages: (LanguageModelChatMessage | vscode.LanguageModelChatMessage2)[],
        _options: ProvideLanguageModelChatResponseOptions,
        progress: Progress<vscode.LanguageModelResponsePart2>,
        token: CancellationToken
    ) {
        debugObj('Gemini CLI Chat model: ', model, this.extension.outputChannel)
        debugObj('Gemini CLI (with Able) messages:\n', () => renderMessages(messages), this.extension.outputChannel)

        const lastMessage = messages[messages.length - 1]
        const contentArray = await renderMessageContent(lastMessage)
        const prompt = contentArray.join('\n')

//        debugObj('Gemini CLI Chat prompt: ', prompt, this.extension.outputChannel)
        const ret = await exucuteGeminiCliCommand(prompt, model.id, '/Users/tamura/src/github/vscode-able/lib/geminicli/system.md', token)
        progress.report(new vscode.LanguageModelTextPart(ret))

        debugObj('Gemini CLI Chat reply: ', ret, this.extension.outputChannel)
        return Promise.resolve()
    }

    async provideTokenCount(_model: LanguageModelChatInformation, text: string | LanguageModelChatMessage | vscode.LanguageModelChatMessage2): Promise<number> {
        return tokenLength(text)
    }

    async generateContext(messages: (LanguageModelChatMessage | vscode.LanguageModelChatMessage2)[]) {
        const lastMessage = messages[messages.length - 1]
        const restMessages = lastMessage.role === vscode.LanguageModelChatMessageRole.User ? messages.slice(0, messages.length - 1) : messages
        let newUserPrompt = ''
        const sytemsPrompts: string[] = []
        const conversationTurns: string[] = []
        const attachments: Attachment[] = []
        const result: string[] = []

        if (lastMessage.role === vscode.LanguageModelChatMessageRole.User) {
            const turn = await renderMessageWithTag(lastMessage)
            const { attachments: attachmentsInTurn, userPrompt } = tweakUserPrompt(turn)
            newUserPrompt = userPrompt
            attachments.push(...attachmentsInTurn)
        }
        for (const message of restMessages) {
            if (message.role === vscode.LanguageModelChatMessageRole.System) {
                const turn = await renderMessageWithTag(message)
                sytemsPrompts.push(turn)
            } else if (message.role === vscode.LanguageModelChatMessageRole.User) {
                const turn = await renderMessageWithTag(message)
                const { attachments: attachmentsInTurn, newInput } = extractAttachments(turn)
                conversationTurns.push(newInput)
                attachments.push(...attachmentsInTurn)
            } else if (message.role === vscode.LanguageModelChatMessageRole.Assistant) {
                const turn = await renderMessageWithTag(message)
                conversationTurns.push(turn)
            }
        }
        result.push(newUserPrompt)
        result.push(...sytemsPrompts)
        result.push('<conversationHistory>\n')
        result.push(...conversationTurns)
        result.push('\n</conversationHistory>')

        return result.join('\n')
    }

}
