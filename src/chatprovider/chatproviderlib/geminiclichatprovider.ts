import * as vscode from 'vscode'
import { CancellationToken, LanguageModelChatMessage, ProvideLanguageModelChatResponseOptions, Progress, LanguageModelChatInformation, LanguageModelChatProvider } from 'vscode'
import { debugObj } from '../../utils/debug.js'
import { renderMessages } from '../../utils/renderer.js'
import { tokenLength } from './openaicompatchatproviderlib/tokencount.js'


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
        this.extension.outputChannel.info('GeminiCliChatProvider initialized')
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
                    toolCalling: false,
                    imageInput: false
                },
            })
        }
        return result
    }

    provideLanguageModelChatResponse(
        _model: LanguageModelChatInformation,
        messages: (LanguageModelChatMessage | vscode.LanguageModelChatMessage2)[],
        _options: ProvideLanguageModelChatResponseOptions,
        _progress: Progress<vscode.LanguageModelResponsePart2>,
        _token: CancellationToken
    ) {

        debugObj('Gemini (with Able) messages:\n', () => renderMessages(messages), this.extension.outputChannel)

        const allContent = ''

        debugObj('Chat reply: ', allContent, this.extension.outputChannel)

        return Promise.resolve()
    }

    async provideTokenCount(_model: LanguageModelChatInformation, text: string | LanguageModelChatMessage | vscode.LanguageModelChatMessage2): Promise<number> {
        return tokenLength(text)
    }

}
