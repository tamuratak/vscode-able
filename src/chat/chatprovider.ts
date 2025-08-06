import * as vscode from 'vscode'
import { CancellationToken, ChatResponseFragment2, LanguageModelChatMessage, LanguageModelChatMessageRole, LanguageModelChatProvider2, LanguageModelChatRequestHandleOptions, Progress, LanguageModelTextPart, LanguageModelChatInformation, LanguageModelToolResultPart, LanguageModelToolCallPart } from 'vscode'
import { GoogleGenAI, Model, Content, Part, GenerateContentResponse, Tool, FunctionResponse, FunctionDeclaration } from '@google/genai'
import { geminiAuthServiceId } from './auth/authproviders'


type GeminiChatInformation = LanguageModelChatInformation & {
    model: Model
}

const toolCallIdNameMap = new Map<string, string>()

function convertLanguageModelChatMessageToContent(message: LanguageModelChatMessage): Content {
    const parts: Part[] = []
    for (const part of message.content) {
        if (part instanceof LanguageModelTextPart) {
            parts.push({ text: part.value })
        } else if (part instanceof LanguageModelToolCallPart) {
            toolCallIdNameMap.set(part.callId, part.name)
            parts.push({
                functionCall: {
                    id: part.callId,
                    name: part.name,
                    args: part.input as Record<string, unknown>
                }
            })
        } else if (part instanceof LanguageModelToolResultPart) {
            const functionResponse: FunctionResponse = {
                id: part.callId,
                response: {
                    output: part.content
                }
            }
            const name = toolCallIdNameMap.get(part.callId)
            if (name) {
                functionResponse.name = name
            }
            parts.push({ functionResponse })
        }
    }
    return {
        role: message.role === LanguageModelChatMessageRole.Assistant ? 'model' : 'user',
        parts
    }
}

export class GeminiChatProvider implements LanguageModelChatProvider2<GeminiChatInformation> {
    private readonly aiModelIds = [
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'gemma-3-27b-it'
    ]

    constructor(
        private readonly extension: {
            readonly outputChannel: vscode.LogOutputChannel,
        }
    ) {
        this.extension.outputChannel.info('GeminiChatProvider initialized')
    }

    async prepareLanguageModelChat(options: { silent: boolean; }): Promise<GeminiChatInformation[]> {
        try {
            const session = await vscode.authentication.getSession(geminiAuthServiceId, [], { silent: options.silent })
            if (!session) {
                return []
            }
            const apiKey = session.accessToken
            const ai = new GoogleGenAI({ apiKey })
            const result: GeminiChatInformation[] = []
            for await (const model of await ai.models.list()) {
                // model.name is like 'models/gemini-2.5-pro'
                const id = this.aiModelIds.find(m => model.name?.endsWith(m))
                if (!id) {
                    continue
                }
                result.push({
                    id,
                    name: model.displayName ?? id,
                    family: id,
                    version: model.version ?? id,
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
        options: LanguageModelChatRequestHandleOptions,
        progress: Progress<ChatResponseFragment2>,
        token: CancellationToken
    ): Promise<void> {
        const session = await vscode.authentication.getSession(geminiAuthServiceId, [], { silent: true })
        if (!session) {
            return
        }
        const apiKey = session.accessToken
        const ai = new GoogleGenAI({ apiKey })
        toolCallIdNameMap.clear()
        const contents: Content[] = messages.map(convertLanguageModelChatMessageToContent)

        const functionDeclarations: FunctionDeclaration[] = options.tools?.map(t => {
            return {
                name: t.name,
                description: t.description,
                parametersJsonSchema: t.inputSchema

            }
        }) ?? []
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
                        part: new LanguageModelToolCallPart(call.id, call.name, call.args)
                    })
                    index++
                }
            }
        }
    }

    async provideTokenCount(model: GeminiChatInformation, text: string | LanguageModelChatMessage): Promise<number> {
        const session = await vscode.authentication.getSession(geminiAuthServiceId, [], { silent: true })
        if (!session) {
            throw new Error('No authentication session found for Gemini')
        }
        const apiKey = session.accessToken
        const ai = new GoogleGenAI({ apiKey })
        const contents = typeof text === 'string' ? [text] : [convertLanguageModelChatMessageToContent(text)]
        const result = await ai.models.countTokens({ model: model.id, contents })
        if (result.totalTokens === undefined) {
            throw new Error('Token count not available from Gemini API')
        }
        return result.totalTokens
    }
}
