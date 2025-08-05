import * as vscode from 'vscode'
import { CancellationToken, ChatResponseFragment2, LanguageModelChatMessage, LanguageModelChatMessageRole, LanguageModelChatProvider2, LanguageModelChatRequestHandleOptions, Progress, LanguageModelTextPart, LanguageModelChatInformation } from 'vscode'
import { GoogleGenAI, Model, Content, Part, GenerateContentResponse } from '@google/genai'
import { geminiAuthServiceId } from './auth/authproviders';

type GeminiChatInformation = LanguageModelChatInformation & {
    model: Model
}

function toGeminiRole(role: LanguageModelChatMessageRole): 'user' | 'model' {
    if (role === LanguageModelChatMessageRole.User) {
        return 'user'
    }
    return 'model'
}

export class GeminiChatProvider implements LanguageModelChatProvider2<GeminiChatInformation> {
    private readonly aiModels = [
        'models/gemini-2.5-pro',
        'models/gemini-2.5-flash',
        'models/gemma-3-27b-it'
    ]

    constructor(
        private readonly extension: {
            readonly outputChannel: vscode.LogOutputChannel,
        }
    ) {
        this.extension.outputChannel.info('GeminiChatProvider initialized')
    }

    async prepareLanguageModelChat(options: { silent: boolean; }, _token: CancellationToken): Promise<GeminiChatInformation[]> {
        try {
            const session = await vscode.authentication.getSession(geminiAuthServiceId, [], { silent: options.silent })
            if (!session) {
                return []
            }
            const apiKey = session.accessToken
            const ai = new GoogleGenAI({ apiKey })
            const result: GeminiChatInformation[] = []
            for await (const model of await ai.models.list()) {
                if (!model.name || !this.aiModels.includes(model.name)) {
                    continue
                }
                const match = model.name.match(/models\/([^-]*)-([^-]*)-([^-]*)/)
                result.push({
                    id: model.name,
                    name: model.displayName ?? model.name,
                    family: match?.[1] ?? model.name,
                    version: model.version ?? model.name,
                    maxInputTokens: model.inputTokenLimit ?? 0,
                    maxOutputTokens: model.outputTokenLimit ?? 0,
                    auth: true,
                    capabilities: {
                        toolCalling: true,
                    },
                    model
                })
            }
            return result
        } catch (e) {
            this.extension.outputChannel.error(`Failed to prepare Gemini chat: ${JSON.stringify(e)}`)
            return []
        }
    }

    async provideLanguageModelChatResponse(
        model: GeminiChatInformation,
        messages: LanguageModelChatMessage[],
        _options: LanguageModelChatRequestHandleOptions,
        progress: Progress<ChatResponseFragment2>,
        token: CancellationToken
    ): Promise<void> {
        const session = await vscode.authentication.getSession(geminiAuthServiceId, [], { silent: true })
        if (!session) {
            return
        }
        const apiKey = session.accessToken
        const ai = new GoogleGenAI({ apiKey })

        const contents: Content[] = messages.map(m => {
            const parts: Part[] = []
            for (const part of m.content) {
                if (part instanceof LanguageModelTextPart) {
                    parts.push({ text: part.value })
                } else if (part instanceof vscode.LanguageModelToolCallPart) {
                    // TODO LanguageModelToolCallPart -> FunctionCall へ変換
                } else {
                    // TODO LanguageModelToolResultPart -> FunctionResponse へ変換
                }
            }
            return {
                role: toGeminiRole(m.role),
                parts
            }
        })

        // vscode.lm.tools -> FunctionDeclaration へ変換
        const result: AsyncGenerator<GenerateContentResponse> = await ai.models.generateContentStream({ model: model.id, contents })

        for await (const chunk of result) {
            if (token.isCancellationRequested) {
                break
            }
            const text = chunk.text
            if (text) {
                progress.report({
                    index: 0,
                    part: {
                        value: text
                    }
                })
            }
        }
    }

    async provideTokenCount(model: GeminiChatInformation, text: string | LanguageModelChatMessage, _token: CancellationToken): Promise<number> {
        const session = await vscode.authentication.getSession(geminiAuthServiceId, [], { silent: true })
        if (!session) {
            return 0
        }
        const apiKey = session.accessToken
        const ai = new GoogleGenAI({ apiKey })
        const content = typeof text === 'string' ? text : text.content
        if (typeof content !== 'string') {
            // TODO: support non-string content
            return 0
        }
        const result = await ai.models.countTokens({ model: model.id, contents: [{ parts: [{ text: content }], role: 'user' }] })
        return result.totalTokens ?? 0
    }
}
