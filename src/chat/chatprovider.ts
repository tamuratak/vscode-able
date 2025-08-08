import * as vscode from 'vscode'
import { CancellationToken, ChatResponseFragment2, LanguageModelChatMessage, LanguageModelChatMessageRole, LanguageModelChatProvider2, LanguageModelChatRequestHandleOptions, Progress, LanguageModelTextPart, LanguageModelChatInformation, LanguageModelToolCallPart } from 'vscode'
import { GoogleGenAI, Model, Content, Part, GenerateContentResponse, Tool, FunctionResponse, FunctionDeclaration } from '@google/genai'
import { geminiAuthServiceId } from './auth/authproviders'
import { getNonce } from '../utils/getnonce.js'
import { renderToolResult } from '../utils/toolresult.js'


type GeminiChatInformation = LanguageModelChatInformation & {
    model: Model
}

const toolCallIdNameMap = new Map<string, string>()
const nameToolCallIdMap = new Map<string, string>()

export class GeminiChatProvider implements LanguageModelChatProvider2<GeminiChatInformation> {
    private readonly aiModelIds = [
        'gemini-2.5-pro',
        'gemini-2.5-flash',
        'gemini-2.0-flash',
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
                    description: model.description ?? 'Gemini',
                    auth: true,
                    capabilities: {
                        toolCalling: id.startsWith('gemini')
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
        messages: (LanguageModelChatMessage | vscode.LanguageModelChatMessage2)[],
        options: LanguageModelChatRequestHandleOptions,
        progress: Progress<ChatResponseFragment2>,
        token: CancellationToken
    ): Promise<void> {
        const session = await vscode.authentication.getSession(geminiAuthServiceId, [], { silent: true })
        if (!session) {
            throw new Error('No authentication session found for Gemini (with Able)')
        }
        const apiKey = session.accessToken
        const ai = new GoogleGenAI({ apiKey })
        const contents: Content[] = await Promise.all(messages.map(m => this.convertLanguageModelChatMessageToContent(m)))

        const functionDeclarations: FunctionDeclaration[] = options.tools?.map(t => {
            return {
                name: t.name,
                description: t.description,
                parametersJsonSchema: t.inputSchema

            }
        }) ?? []
        const tools: Tool[] = model.capabilities?.toolCalling ? [{ functionDeclarations }] : []

        this.extension.outputChannel.debug(`Gemini chat request: ${JSON.stringify({ model: model.id, contents }, null, 2)}`)
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
            const index = 0
            this.extension.outputChannel.debug(`Gemini chat response chunk: ${JSON.stringify({ text: chunk.text, functionCalls: chunk.functionCalls }, null, 2)}`)
            if (token.isCancellationRequested) {
                break
            }
            const text = chunk.text
            if (text) {
                progress.report({
                    index: 0,
                    part: new LanguageModelTextPart(text)
                } satisfies ChatResponseFragment2)
            }
            const functionCalls = chunk.functionCalls
            if (functionCalls) {
                for (const call of functionCalls) {
                    if (call.name === undefined || call.args === undefined) {
                        continue
                    }
                    const callId = call.id ?? getNonce()
                    nameToolCallIdMap.set(call.name, callId)
                    toolCallIdNameMap.set(callId, call.name)
                    progress.report({
                        index,
                        part: new LanguageModelTextPart('Tool call')
                    })
                    progress.report({
                        index,
                        part: new LanguageModelToolCallPart(callId, call.name, call.args)
                    })
                }
            }
        }
    }

    async provideTokenCount(model: GeminiChatInformation, text: string | LanguageModelChatMessage | vscode.LanguageModelChatMessage2): Promise<number> {
        const session = await vscode.authentication.getSession(geminiAuthServiceId, [], { silent: true })
        if (!session) {
            throw new Error('No authentication session found for Gemini (with Able)')
        }
        const apiKey = session.accessToken
        const ai = new GoogleGenAI({ apiKey })
        const contents = typeof text === 'string' ? [text] : [await this.convertLanguageModelChatMessageToContent(text)]
        const result = await ai.models.countTokens({ model: model.id, contents })
        if (result.totalTokens === undefined) {
            throw new Error('Token count not available from Gemini API')
        }
        return result.totalTokens
    }

    async convertLanguageModelChatMessageToContent(message: LanguageModelChatMessage | vscode.LanguageModelChatMessage2): Promise<Content> {
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
                const name = toolCallIdNameMap.get(part.callId)
                if (name) {
                    functionResponse.name = name
                }
                parts.push({ functionResponse })
            } else {
                // TODO: LanguageModelDataPart case
                this.extension.outputChannel.info(`Skipping LanguageModelDataPart length: ${part.data.length}`)
            }
        }
        return {
            role: message.role === LanguageModelChatMessageRole.Assistant ? 'model' : 'user',
            parts
        }
    }

}
