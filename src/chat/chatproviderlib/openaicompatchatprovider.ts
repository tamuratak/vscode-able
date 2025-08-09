import * as vscode from 'vscode'
import { CancellationToken, ChatResponseFragment2, LanguageModelChatMessage, LanguageModelChatMessageRole, LanguageModelChatProvider2, LanguageModelChatRequestHandleOptions, Progress, LanguageModelTextPart, LanguageModelChatInformation, LanguageModelToolCallPart } from 'vscode'
import OpenAI from 'openai'
import { openaiAuthServiceId } from '../../auth/authproviders.js'
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

export abstract class OpenAICompatChatProvider implements LanguageModelChatProvider2 {
    abstract readonly _serviceName: string

    private readonly tokenizer = new ExternalPromise<TikTokenizer>()

    constructor(
        private readonly extension: {
            readonly outputChannel: vscode.LogOutputChannel,
        }
    ) {
        this.extension.outputChannel.info(this.serviceName + ': OpenAICompatChatProvider initialized')
        void this.initTokenizer()
    }

    get serviceName(): string {
        return this._serviceName
    }

    abstract get authServiceId(): string
    abstract get apiBaseUrl(): string | undefined
    abstract get aiModelIds(): LanguageModelChatInformation[]
    abstract get categoryLabel(): string

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
            const session = await vscode.authentication.getSession(this.authServiceId, [], { silent: options.silent })
            if (!session) {
                return []
            }
            const apiKey = session.accessToken
            const openai = this.apiBaseUrl ? new OpenAI({ apiKey, baseURL: this.apiBaseUrl }) : new OpenAI({ apiKey })
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
                    cost: 'Able',
                    name: model.name,
                    family: model.family,
                    version: model.version,
                    maxInputTokens: model.maxInputTokens,
                    maxOutputTokens: model.maxOutputTokens,
                    description: model.description ?? '',
                    auth: true,
                    capabilities: {
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
        const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = (await Promise.all(messages.map(m => this.convertLanguageModelChatMessageToChatCompletionMessageParam(m)))).flat()
        const tools: OpenAI.Chat.ChatCompletionTool[] | undefined = options.tools?.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.inputSchema as Record<string, unknown>
            }
        }))
        const toolChoice = options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : (tools ? 'auto' : undefined)
        const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
            model: model.id,
            messages: chatMessages,
            stream: true,
            parallel_tool_calls: false // Parallel tool calls are not supported
        }
        if (tools) {
            params.tools = tools
            if (toolChoice) {
                params.tool_choice = toolChoice
            }
        }
        this.extension.outputChannel.debug(`OpenAI chat params: ${JSON.stringify(params, null, 2)}`)
        const stream = await openai.chat.completions.create(params)
        let toolCall: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall | undefined
        let toolArguments = ''
        let allContent = ''
        for await (const chunk of stream) {
            if (token.isCancellationRequested) {
                break
            }
            const delta = chunk.choices[0]?.delta
            if (delta) {
                allContent += delta.content ?? ''
                this.reportContent(delta.content, progress)
            }
            const toolCallDelta = delta.tool_calls?.[0]
            if (toolCallDelta) {
                toolCall = toolCall ?? toolCallDelta
                toolArguments += toolCallDelta.function?.arguments ?? ''
            }
        }
        this.extension.outputChannel.debug('LLM Reply: ' + allContent)
        if (toolCall && toolCall.function) {
            toolCall.function.arguments = toolArguments
            this.extension.outputChannel.debug(`ToolCall: ${JSON.stringify(toolCall, null, 2)}`)
            this.reportToolCall(toolCall, progress)
        }
    }

    reportContent(content: string | null | undefined, progress: Progress<ChatResponseFragment2>) {
        if (content) {
            progress.report({
                index: 0,
                part: new LanguageModelTextPart(content)
            } satisfies ChatResponseFragment2)
        }
    }

    reportToolCall(toolCall: FunctionToolCall, progress: Progress<ChatResponseFragment2>) {
        if (!toolCall) {
            return
        }
        if (toolCall.function === undefined || toolCall.function.name === undefined || toolCall.function.arguments === undefined) {
            return
        }
        const callId = toolCall.id ?? this.generateCallId()
        let args: object
        try {
            if (toolCall.function.arguments === '') {
                args = {}
            } else {
                args = JSON.parse(toolCall.function.arguments) as object
            }
        } catch (e) {
            this.extension.outputChannel.error(`Failed to parse tool call arguments: ${toolCall.function.arguments}. Error: ${e instanceof Error ? e.message : String(e)}`)
            return
        }
        progress.report({
            index: 0,
            part: new LanguageModelToolCallPart(callId, toolCall.function.name, args)
        })
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
    ): Promise<OpenAI.Chat.ChatCompletionMessageParam[]> {
        const result: OpenAI.Chat.ChatCompletionMessageParam[] = []
        const assistantContent: OpenAI.Chat.ChatCompletionAssistantMessageParam['content'] = []
        const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = []
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
                } satisfies OpenAI.Chat.ChatCompletionToolMessageParam)
            } else {
                // TODO: LanguageModelDataPart case
                this.extension.outputChannel.info(`Skipping LanguageModelDataPart length: ${part.data.length}`)
            }
        }
        if (message.role === LanguageModelChatMessageRole.Assistant) {
            if (toolCalls.length > 0) {
                return [{
                    role: 'assistant',
                    content: assistantContent,
                    tool_calls: toolCalls
                }] satisfies OpenAI.Chat.ChatCompletionAssistantMessageParam[]
            } else {
                return [{
                    role: 'assistant',
                    content: assistantContent
                }] satisfies OpenAI.Chat.ChatCompletionAssistantMessageParam[]
            }
        } else {
            return result
        }
    }

}
