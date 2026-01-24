import * as vscode from 'vscode'
import { CancellationToken, LanguageModelChatMessage, ProvideLanguageModelChatResponseOptions, Progress, LanguageModelChatInformation, LanguageModelChatProvider } from 'vscode'
import { debugObj } from '../utils/debug.js'
import { renderMessageWithTag } from '../utils/renderer.js'
import { tokenLength } from './chatproviderlib/openaicompatchatproviderlib/tokencount.js'
import { executeGeminiCliCommand } from '../utils/geminicli.js'
import { Attachment, extractAttachments, replaceInstsInSystemPrompt, tweakUserPrompt } from './geminiclilib/utils.js'


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
        const newPrompt = await this.generateContext(messages)
        debugObj('Gemini CLI Chat full prompt: ', newPrompt, this.extension.outputChannel)
        const ret = await executeGeminiCliCommand(newPrompt, model.id, '/Users/tamura/src/github/vscode-able/lib/geminicli/system.md', token)
        progress.report(new vscode.LanguageModelTextPart(ret))
        debugObj('Gemini CLI Chat reply: ', ret, this.extension.outputChannel)
        return Promise.resolve()
    }

    async provideTokenCount(_model: LanguageModelChatInformation, text: string | LanguageModelChatMessage | vscode.LanguageModelChatMessage2): Promise<number> {
        return tokenLength(text)
    }

    private async generateContext(messages: (LanguageModelChatMessage | vscode.LanguageModelChatMessage2)[]) {
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
                const newPrompt = replaceInstsInSystemPrompt(turn)
                sytemsPrompts.push(newPrompt)
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
        result.push('<conversationHistory>')
        result.push(...conversationTurns)
        result.push('</conversationHistory>')
        result.push('<attachments>')
        const alreadyAdded = new Set<string>()
        for (const attachment of attachments) {
            if (!attachment.filePath || !attachment.id) {
                continue
            }
            if (alreadyAdded.has(attachment.filePath)) {
                continue
            }
            alreadyAdded.add(attachment.filePath)
            const attachedFileUri = vscode.Uri.file(attachment.filePath)
            try {
                const newContent = await vscode.workspace.fs.readFile(attachedFileUri)
                const newContentStr = new TextDecoder().decode(newContent)
                result.push(`<attachment id="${attachment.id}" filePath="${attachment.filePath}">`)
                result.push(newContentStr)
                result.push('</attachment>')
            } catch (err) {
                this.extension.outputChannel.error(`Failed to read attachment file: ${attachment.filePath}`, err as Error)
            }
        }
        result.push('</attachments>')

        return result.join('\n')
    }

}
