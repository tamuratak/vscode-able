import * as vscode from 'vscode'
import { CancellationToken, ChatResponseFragment2, LanguageModelChatMessage, LanguageModelChatMessageRole, LanguageModelChatProvider2, LanguageModelChatRequestHandleOptions, Progress, LanguageModelTextPart, LanguageModelChatInformation, LanguageModelToolResultPart, LanguageModelToolCallPart } from 'vscode'
import { GoogleGenAI, Model, Content, Part, GenerateContentResponse, Tool } from '@google/genai'
import { geminiAuthServiceId } from './auth/authproviders'
import { FunctionDeclaration } from '@google/genai'

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
                } else if (part instanceof LanguageModelToolCallPart) {
                    parts.push({
                        functionCall: {
                            id: part.callId,
                            name: part.name,
                            args: part.input as Record<string, unknown>
                        }
                    })
                } else if (part instanceof LanguageModelToolResultPart) {
                    parts.push({
                        functionResponse: {
                            id: part.callId,
                            response: {
                                output: part.content
                            }
                        }
                    })
                }
            }
            return {
                role: toGeminiRole(m.role),
                parts
            }
        })

        const functionDeclarations: FunctionDeclaration[] = vscode.lm.tools.map(t => {
            return {
                name: t.name,
                description: t.description,
                parametersJsonSchema: t.inputSchema

            }
        })
        const tools: Tool[] = [{ functionDeclarations }]

        const result: AsyncGenerator<GenerateContentResponse> = await ai.models.generateContentStream(
            {
                model: model.id,
                contents,
                config: {
                    tools
                }
            }
        )

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
            const functionCalls = chunk.functionCalls
            if (functionCalls) {
                let index = 0
                for (const call of functionCalls) {
                    if (call.id === undefined || call.name === undefined || call.args === undefined) {
                        continue
                    }
                    progress.report({
                        index,
                        part: new vscode.LanguageModelToolCallPart(call.id, call.name, call.args)
                    })
                    index++
                }
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
