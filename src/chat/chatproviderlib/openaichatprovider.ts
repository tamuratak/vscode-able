import * as vscode from 'vscode'
import { CancellationToken, ChatResponseFragment2, LanguageModelChatMessage, LanguageModelChatMessageRole, LanguageModelChatProvider2, LanguageModelChatRequestHandleOptions, Progress, LanguageModelTextPart, LanguageModelChatInformation, LanguageModelToolCallPart } from 'vscode'
import OpenAI from 'openai'
import { Stream } from 'openai/streaming.js'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions/completions.js'
import type { ChatCompletionAssistantMessageParam, ChatCompletionMessageToolCall, ChatCompletionToolMessageParam } from 'openai/resources.mjs'
import { openaiAuthServiceId } from '../auth/authproviders.js'
import { getNonce } from '../../utils/getnonce.js'
import { renderToolResult } from '../../utils/toolresult.js'
import { createByModelName, TikTokenizer } from '@microsoft/tiktokenizer'
import { ExternalPromise } from '../../utils/externalpromise.js'


export interface FunctionToolCall {
    id?: string;
    function?: {
        arguments?: string;
        name?: string;
    }
    type?: 'function';
}

export abstract class OpenAIChatProvider implements LanguageModelChatProvider2 {
    abstract readonly aiModelIds: LanguageModelChatInformation[]
    private readonly tokenizer = new ExternalPromise<TikTokenizer>()

    constructor(
        private readonly extension: {
            readonly outputChannel: vscode.LogOutputChannel,
        }
    ) {
        this.extension.outputChannel.info('OpenAIChatProvider initialized')
        void this.initTokenizer()
    }

    private async initTokenizer() {
        // The BPE rank file will be automatically downloaded and saved to node_modules/@microsoft/tiktokenizer/model if it does not exist.
        this.tokenizer.resolve(await createByModelName('gpt-4o'))
    }

    private async tokenLength(text: string) {
        const tokenizer = await this.tokenizer.promise
        return tokenizer.encode(text).length
    }

    generateCallId(): string {
        return 'call_' + getNonce(16)
    }

    async prepareLanguageModelChat(options: { silent: boolean; }): Promise<LanguageModelChatInformation[]> {
        try {
            const session = await vscode.authentication.getSession(openaiAuthServiceId, [], { silent: options.silent })
            if (!session) {
                return []
            }
            const apiKey = session.accessToken
            const openai = new OpenAI({ apiKey })
            const models = await openai.models.list()
            const result: LanguageModelChatInformation[] = []
            for (const modelInList of models.data) {
                const model = this.aiModelIds.find((m) => m.id === modelInList.id)
                if (!model) {
                    continue
                }
                result.push({
                    id: model.id,
                    category: {
                        label: 'OpenAI',
                        order: 1001
                    },
                    cost: 'OpenAI',
                    name: model.name,
                    family: model.family,
                    version: model.version,
                    maxInputTokens: model.maxInputTokens,
                    maxOutputTokens: model.maxOutputTokens,
                    description: model.description ?? '',
                    auth: true,
                    capabilities:{
                        toolCalling: model.capabilities?.toolCalling ?? false
                    }
                })
            }
            return result
        } catch (e) {
            this.extension.outputChannel.error(`Failed to prepare OpenAI chat: ${JSON.stringify(e)}`)
            return []
        }
    }

    async provideLanguageModelChatResponse(
        model: LanguageModelChatInformation,
        messages: (LanguageModelChatMessage | vscode.LanguageModelChatMessage2)[],
        options: LanguageModelChatRequestHandleOptions,
        progress: Progress<ChatResponseFragment2>,
        token: CancellationToken
    ): Promise<void> {
        const session = await vscode.authentication.getSession(openaiAuthServiceId, [], { silent: true })
        if (!session) {
            throw new Error('No authentication session found for OpenAI')
        }
        const apiKey = session.accessToken
        const openai = new OpenAI({ apiKey })
        const chatMessages: ChatCompletionMessageParam[] = (await Promise.all(messages.map(m => this.convertLanguageModelChatMessageToChatCompletionMessageParam(m)))).flat()
        const tools: ChatCompletionTool[] | undefined = options.tools
            ? options.tools.map(t => ({
                type: 'function',
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: (t.inputSchema && Object.keys(t.inputSchema).length > 0
                        ? t.inputSchema
                        : { type: 'object', properties: {} }) as Record<string, unknown>
                }
            }))
            : undefined
        const toolChoice: 'auto' | 'required' = options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : 'auto'
        const params = {
            model: model.id,
            messages: chatMessages,
            stream: true,
            ...(tools ? { tools } : {}),
            tool_choice: toolChoice
        }
        const stream = await openai.chat.completions.create(params)
        if (stream instanceof Stream) {
            for await (const chunk of stream) {
                if (token.isCancellationRequested) {
                    break
                }
                const delta = chunk.choices[0].delta
                if (!delta) {
                    continue
                }
                if (!delta.content && !delta.tool_calls) {
                    continue
                }
                const content = delta.content
                const toolCalls = delta.tool_calls ?? []
                this.reportDelta({content, toolCalls}, progress)
            }
        } else {
            const message = stream.choices[0]?.message
            if (!message) {
                return
            }
            const content = message.content
            const toolCalls = message.tool_calls?.filter((c) => c.type === 'function') ?? []
            this.reportDelta({ content, toolCalls }, progress)
        }
    }

    reportDelta(delta: { content: string | null | undefined; toolCalls: FunctionToolCall[] }, progress: Progress<ChatResponseFragment2>) {
        if (delta.content) {
            progress.report({
                index: 0,
                part: new LanguageModelTextPart(delta.content)
            } satisfies ChatResponseFragment2)
        }
        if (delta?.toolCalls) {
            // TODO
        }
    }

    async provideTokenCount(_model: LanguageModelChatInformation, text: string | LanguageModelChatMessage | vscode.LanguageModelChatMessage2): Promise<number> {
        const baseTokensPerName = 1
        if (typeof text === 'string') {
            return this.tokenLength(text)
        } else {
            let count = 0
            const params = await this.convertLanguageModelChatMessageToChatCompletionMessageParam(text)
            for (const param of params) {
                if (param.role === 'user' || param.role === 'system') {
                    if (typeof param.content === 'string') {
                        count += await this.tokenLength(param.content)
                    } else {
                        for (const c of param.content) {
                            if (c.type === 'text') {
                                count += await this.tokenLength(c.text)
                            }
                        }
                    }
                } else if (param.role === 'assistant') {
                    if (typeof param.content === 'string') {
                        count += await this.tokenLength(param.content)
                    } else if (param.content) {
                        for (const c of param.content) {
                            if (c.type === 'text') {
                                count += await this.tokenLength(c.text)
                            }
                        }
                    }
                    for (const toolCalls of param.tool_calls ?? []) {
                        if (toolCalls.type === 'function') {
                            count += baseTokensPerName
                            count += await this.tokenLength(toolCalls.function.arguments)
                        }
                    }
                } else if (param.role === 'tool') {
                    count += baseTokensPerName
                    for (const c of param.content) {
                        if (typeof c === 'string') {
                            count += await this.tokenLength(c)
                        } else {
                            count += await this.tokenLength(c.text)
                        }
                    }
                }
            }
            return count
        }
    }

    async convertLanguageModelChatMessageToChatCompletionMessageParam(
        message: LanguageModelChatMessage | vscode.LanguageModelChatMessage2
    ): Promise<ChatCompletionMessageParam[]> {
        const result: ChatCompletionMessageParam[] = []
        const assistantContent: ChatCompletionAssistantMessageParam['content'] = []
        const toolCalls: ChatCompletionMessageToolCall[] = []
        for (const part of message.content) {
            if (part instanceof LanguageModelTextPart) {
                if (message.role === LanguageModelChatMessageRole.Assistant) {
                    assistantContent.push({ type: 'text', text: part.value })
                } else {
                    result.push({
                        role: message.role === LanguageModelChatMessageRole.System ? 'system' : 'user',
                        content: part.value
                    })
                }
            } else if (part instanceof LanguageModelToolCallPart) {
                toolCalls.push({
                    type: 'function',
                    id: part.callId,
                    function: {
                        name: part.name,
                        arguments: JSON.stringify(part.input)
                    }
                })
            } else if ((part instanceof vscode.LanguageModelToolResultPart2) || (part instanceof vscode.LanguageModelToolResultPart)) {
                const contents = part.content.filter(c => c instanceof LanguageModelTextPart || c instanceof vscode.LanguageModelPromptTsxPart)
                const toolResult = new vscode.LanguageModelToolResult(contents)
                const content = await renderToolResult(toolResult)
                result.push({
                    role: 'tool',
                    tool_call_id: part.callId,
                    content
                } satisfies ChatCompletionToolMessageParam)
            } else {
                // TODO: LanguageModelDataPart case
                this.extension.outputChannel.info(`Skipping LanguageModelDataPart length: ${part.data.length}`)
            }
        }
        if (message.role === LanguageModelChatMessageRole.Assistant) {
            return [{
                role: 'assistant',
                content: assistantContent,
                tool_calls: toolCalls
            }] satisfies ChatCompletionAssistantMessageParam[]
        } else {
            return result
        }
    }

}
