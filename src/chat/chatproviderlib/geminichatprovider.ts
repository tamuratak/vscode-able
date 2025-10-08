import * as vscode from 'vscode'
import { CancellationToken, LanguageModelChatMessage, LanguageModelChatMessageRole, ProvideLanguageModelChatResponseOptions, Progress, LanguageModelTextPart, LanguageModelDataPart, LanguageModelChatInformation, LanguageModelChatProvider, LanguageModelToolCallPart } from 'vscode'
import { GoogleGenAI, Model, Content, Part, GenerateContentResponse, FunctionResponse, GenerateContentConfig, FunctionCallingConfigMode, FunctionCall } from '@google/genai'
import { GeminiAuthServiceId } from '../../auth/authproviders.js'
import { getNonce } from '../../utils/getnonce.js'
import { renderToolResult } from '../../utils/toolresultrendering.js'
import { getValidator, initValidators } from './toolcallargvalidator.js'
import { debugObj } from '../../utils/debug.js'
import { renderMessages } from '../utils/renderer.js'


type GeminiChatInformation = LanguageModelChatInformation & {
    model: Model
}

const toolCallIdNameMap = new Map<string, string>()


export class GeminiChatProvider implements LanguageModelChatProvider<GeminiChatInformation> {
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

    generateCallId(): string {
        return 'call_' + getNonce(16)
    }

    async provideLanguageModelChatInformation(options: { silent: boolean; }): Promise<GeminiChatInformation[]> {
        try {
            const session = await vscode.authentication.getSession(GeminiAuthServiceId, [], { silent: options.silent })
            if (!session) {
                return []
            }
            const apiKey = session.accessToken
            const ai = new GoogleGenAI({ apiKey })
            const result: GeminiChatInformation[] = []
            const list = await ai.models.list()
            const modelList: Model[] = []
            for await (const model of list) {
                modelList.push(model)
                // model.name is like 'models/gemini-2.5-pro'
                const id = this.aiModelIds.find(m => model.name?.endsWith(m))
                if (!id) {
                    continue
                }
                result.push({
                    id,
                    category: {
                        label: 'Gemini (with Able)',
                        order: 1000
                    },
                    detail: 'Able',
                    name: model.displayName ?? id,
                    family: id,
                    version: model.version ?? id,
                    maxInputTokens: model.inputTokenLimit ?? 0,
                    maxOutputTokens: model.outputTokenLimit ?? 0,
                    tooltip: model.description ?? 'Gemini',
                    requiresAuthorization: true,
                    capabilities: {
                        toolCalling: id.startsWith('gemini'),
                        imageInput: true
                    },
                    model
                })
            }
            debugObj('Gemini (with Able) available models: ', modelList, this.extension.outputChannel)
            return result
        } catch (e) {
            this.extension.outputChannel.error(`Failed to prepare Gemini chat: ${JSON.stringify(e)}`)
            return []
        }
    }

    async provideLanguageModelChatResponse(
        model: GeminiChatInformation,
        messages: (LanguageModelChatMessage | vscode.LanguageModelChatMessage2)[],
        options: ProvideLanguageModelChatResponseOptions,
        progress: Progress<vscode.LanguageModelResponsePart2>,
        token: CancellationToken
    ): Promise<void> {
        const session = await vscode.authentication.getSession(GeminiAuthServiceId, [], { silent: true })
        if (!session) {
            throw new Error('No authentication session found for Gemini (with Able)')
        }
        const apiKey = session.accessToken
        const ai = new GoogleGenAI({ apiKey })
        initValidators(options.tools)
        const contents: Content[] = await Promise.all(messages.map(m => this.convertLanguageModelChatMessageToContent(m)))

        const functionDeclarations = options.tools && options.tools.length > 0 ? options.tools.map(t => {
            return {
                name: t.name,
                description: t.description,
                parametersJsonSchema: t.inputSchema

            }
        }) : undefined
        const config: GenerateContentConfig = model.capabilities?.toolCalling && functionDeclarations ? {
            tools: [{ functionDeclarations }],
            toolConfig: {
                functionCallingConfig: {
                    mode: options.toolMode === vscode.LanguageModelChatToolMode.Required ? FunctionCallingConfigMode.ANY : FunctionCallingConfigMode.AUTO
                }
            }
        } : {}
        this.extension.outputChannel.debug('Gemini (with Able) messages:\n' + await renderMessages(messages))
        const result: AsyncGenerator<GenerateContentResponse> = await ai.models.generateContentStream(
            {
                model: model.id,
                contents,
                config
            }
        ).catch(e => {
            if (e instanceof Error) {
                this.extension.outputChannel.error(e, { model: model.id, contents, config })
            }
            throw e
        })
        let allContent = ''
        for await (const chunk of result) {
            debugObj('Gemini chat response chunk: ', { text: chunk.text, functionCalls: chunk.functionCalls }, this.extension.outputChannel)
            if (token.isCancellationRequested) {
                break
            }
            const text = chunk.text
            if (text && text.length > 0) {
                allContent += text
                progress.report(new LanguageModelTextPart(text))
            }
            const functionCalls = chunk.functionCalls
            if (functionCalls) {
                this.reportToolCall(functionCalls, progress)
            }
        }
        debugObj('Chat reply: ', allContent, this.extension.outputChannel)
    }

    private reportToolCall(functionCalls: FunctionCall[], progress: Progress<LanguageModelTextPart | LanguageModelToolCallPart | LanguageModelDataPart>) {
        for (const call of functionCalls) {
            if (call.name === undefined || call.args === undefined) {
                continue
            }
            const callId = call.id ?? this.generateCallId()
            toolCallIdNameMap.set(callId, call.name)
            const validator = getValidator(call.name)
            if (validator === undefined) {
                this.extension.outputChannel.error(`No validator found for tool call: ${call.name}`)
                throw new Error(`No validator found for tool call: ${call.name}`)
            }
            if (!validator(call.args)) {
                this.extension.outputChannel.error(`Invalid tool call arguments for ${call.name}: ${JSON.stringify(call.args)}`)
                throw new Error(`Invalid tool call arguments for ${call.name}: ${JSON.stringify(call.args)}`)
            }
            progress.report(new LanguageModelToolCallPart(callId, call.name, call.args))
        }
    }

    async provideTokenCount(model: GeminiChatInformation, text: string | LanguageModelChatMessage | vscode.LanguageModelChatMessage2): Promise<number> {
        const session = await vscode.authentication.getSession(GeminiAuthServiceId, [], { silent: true })
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
            } else if (part instanceof vscode.LanguageModelDataPart) {
                parts.push({
                    inlineData: {
                        data: Buffer.from(part.data).toString('base64'),
                        mimeType: part.mimeType
                    }
                })
            } else {
                // TODO: LanguageModelThinkingPart case
                part satisfies vscode.LanguageModelThinkingPart
                this.extension.outputChannel.info('Skipping LanguageModelThinkingPart')
            }
        }
        return {
            role: message.role === LanguageModelChatMessageRole.Assistant ? 'model' : 'user',
            parts
        }
    }

}
