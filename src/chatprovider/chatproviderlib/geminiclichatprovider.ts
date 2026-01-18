import * as vscode from 'vscode'
import { CancellationToken, LanguageModelChatMessage, LanguageModelChatMessageRole, ProvideLanguageModelChatResponseOptions, Progress, LanguageModelTextPart, LanguageModelChatInformation, LanguageModelChatProvider, LanguageModelToolCallPart } from 'vscode'
import { Model, Content, Part, FunctionResponse } from '@google/genai'
import { renderToolResult } from '../../utils/toolresultrendering.js'
import { debugObj } from '../../utils/debug.js'
import { renderMessages } from '../../utils/renderer.js'
import { isSupportedMimeType } from './mime.js'
import { tokenLength } from './openaicompatchatproviderlib/tokencount.js'


type GeminiChatInformation = LanguageModelChatInformation & {
    model: Model
}

export class GeminiCliChatProvider implements LanguageModelChatProvider<LanguageModelChatInformation> {
    private readonly aiModelIds = [
        ['gemini-3-pro-preview', 'Gemini 3 Pro'],
        ['gemini-3-flash-preview', 'Gemini 3 Flash'],
        ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
        ['gemini-2.5-flash', 'Gemini 2.5 Flash'],
        ['gemini-2.5-flash-lite', 'Gemini 2.5 Flash Lite']
    ] as const
    private readonly toolCallIdNameMap = new Map<string, string>()
    private readonly toolCallIdThoughtSignatureMap = new Map<string, string>()

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
        _model: GeminiChatInformation,
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

    async provideTokenCount(_model: GeminiChatInformation, text: string | LanguageModelChatMessage | vscode.LanguageModelChatMessage2): Promise<number> {
        return tokenLength(text)
    }

    async convertLanguageModelChatMessageToContent(message: LanguageModelChatMessage | vscode.LanguageModelChatMessage2): Promise<Content> {
        const parts: Part[] = []
        for (const part of message.content) {
            if (part instanceof LanguageModelTextPart) {
                parts.push({ text: part.value })
            } else if (part instanceof LanguageModelToolCallPart) {
                this.toolCallIdNameMap.set(part.callId, part.name)
                const thoughtSignature = this.toolCallIdThoughtSignatureMap.get(part.callId)
                parts.push({
                    functionCall: {
                        id: part.callId,
                        name: part.name,
                        args: part.input as Record<string, unknown>
                    },
                    ...(thoughtSignature ? { thoughtSignature } : {})
                })
            } else if ((part instanceof vscode.LanguageModelToolResultPart2) || (part instanceof vscode.LanguageModelToolResultPart)) {
                const contents = part.content.filter(c => c instanceof LanguageModelTextPart || c instanceof vscode.LanguageModelPromptTsxPart)
                const toolResult = new vscode.LanguageModelToolResult(contents)
                const output = await renderToolResult(toolResult)
                const functionResponse: FunctionResponse = {
                    id: part.callId,
                    response: {
                        output
                    }
                }
                const name = this.toolCallIdNameMap.get(part.callId)
                if (name) {
                    functionResponse.name = name
                }
                parts.push({ functionResponse })
            } else if (part instanceof vscode.LanguageModelDataPart) {
                const mimeType = part.mimeType
                const isAllowed = isSupportedMimeType(mimeType)
                if (!isAllowed) {
                    this.extension.outputChannel.error(`Unsupported mimeType in LanguageModelDataPart: ${mimeType}`)
                    continue
                }
                parts.push({
                    inlineData: {
                        data: Buffer.from(part.data).toString('base64'),
                        mimeType
                    }
                })
            } else if (part instanceof vscode.LanguageModelThinkingPart) {
                if (part.id) {
                    parts.push({
                        thought: true,
                        thoughtSignature: part.id
                    })
                }
            } else {
                part satisfies never
            }
        }
        return {
            role: message.role === LanguageModelChatMessageRole.Assistant ? 'model' : 'user',
            parts
        }
    }

}
