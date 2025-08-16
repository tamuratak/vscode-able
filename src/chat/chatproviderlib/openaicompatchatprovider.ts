import * as vscode from 'vscode'
import { CancellationToken, LanguageModelChatMessage, LanguageModelChatMessageRole, LanguageModelChatRequestHandleOptions, LanguageModelChatProvider, Progress, LanguageModelTextPart, LanguageModelChatInformation, LanguageModelToolCallPart } from 'vscode'
import OpenAI from 'openai'
import { getNonce } from '../../utils/getnonce.js'
import { renderToolResult } from '../../utils/toolresultrendering.js'
import { createByModelName, TikTokenizer } from '@microsoft/tiktokenizer'
import { ExternalPromise } from '../../utils/externalpromise.js'
import { getValidator, initValidators } from './toolcallargvalidator.js'
import { debugObj } from '../../utils/debug.js'


export interface ModelInformation extends LanguageModelChatInformation {
    options?: {
        readonly reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
    } | undefined
}

export abstract class OpenAICompatChatProvider implements LanguageModelChatProvider {
    abstract readonly serviceName: string
    abstract readonly apiBaseUrl: string | undefined
    abstract readonly streamSupported: boolean
    abstract readonly responseSupported: boolean

    private readonly tokenizer = new ExternalPromise<TikTokenizer>()

    constructor(
        private readonly extension: {
            readonly outputChannel: vscode.LogOutputChannel,
        }
    ) {
        setTimeout(() => this.extension.outputChannel.info(this.serviceName + ': OpenAICompatChatProvider initialized'), 0)
        void this.initTokenizer()
    }

    abstract get authServiceId(): string
    abstract get aiModelIds(): ModelInformation[]
    abstract get categoryLabel(): string

    private async initTokenizer() {
        // The BPE rank file will be automatically downloaded and saved to node_modules/@microsoft/tiktokenizer/model if it does not exist.
        this.tokenizer.resolve(await createByModelName('gpt-4o'))
    }

    private async tokenLength(text: string) {
        const tokenizer = await this.tokenizer.promise
        return tokenizer.encode(text).length
    }

    private generateCallId(): string {
        return 'call_' + getNonce(16)
    }

    private createClient(apiKey: string) {
        return this.apiBaseUrl ? new OpenAI({ apiKey, baseURL: this.apiBaseUrl }) : new OpenAI({ apiKey })
    }

    async prepareLanguageModelChatInformation(options: { silent: boolean; }): Promise<ModelInformation[]> {
        try {
            const session = await vscode.authentication.getSession(this.authServiceId, [], { silent: options.silent })
            if (!session) {
                return []
            }
            const apiKey = session.accessToken
            const openai = this.createClient(apiKey)
            const models = await openai.models.list()
            const result: ModelInformation[] = []
            debugObj(`${this.categoryLabel} available models: `, models.data, this.extension.outputChannel)
            for (const modelInList of models.data) {
                for (const model of this.aiModelIds.filter((m) => m.family === modelInList.id)) {
                    if (!model) {
                        continue
                    }
                    result.push({
                        ...model,
                        category: {
                            label: this.categoryLabel,
                            order: 1001
                        },
                        detail: 'Able',
                        auth: true
                    })
                }
            }
            return result
        } catch (e) {
            this.extension.outputChannel.error(`Failed to prepare OpenAI chat: ${JSON.stringify(e)}`)
            return []
        }
    }

    async provideLanguageModelChatResponse(
        model: ModelInformation,
        messages: (LanguageModelChatMessage | vscode.LanguageModelChatMessage2)[],
        options: LanguageModelChatRequestHandleOptions,
        progress: Progress<LanguageModelTextPart | LanguageModelToolCallPart>,
        token: CancellationToken
    ): Promise<void> {
        const session = await vscode.authentication.getSession(this.authServiceId, [], { silent: true })
        if (!session) {
            throw new Error('No authentication session found for ' + this.authServiceId)
        }
        const apiKey = session.accessToken
        const openai = this.createClient(apiKey)
        initValidators(options.tools)
        const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[] = (await Promise.all(messages.map(m => this.convertLanguageModelChatMessageToChatCompletionMessageParam(m)))).flat()

        // If the provider supports the newer Responses API, construct a ResponseCreateParams
        // and call createResponse which handles streaming/responses-specific events
        if (this.responseSupported) {
            const tools: OpenAI.Responses.Tool[] | undefined = options.tools?.map(t => ({
                // map simple function-style tool descriptions to the Responses API tool shape
                type: 'function' as const,
                name: t.name,
                description: t.description,
                parameters: t.inputSchema as Record<string, unknown>,
                // enforce strict parameter validation by default
                strict: true
            }))

            const toolChoice = options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : (tools && tools.length > 0 ? 'auto' : undefined)

            // Responses API accepts an `input` which can be an array of message-like objects.
            // Convert our ChatCompletion message params to EasyInputMessage (role + content).
            const input: OpenAI.Responses.EasyInputMessage[] = chatMessages.map((m: OpenAI.Chat.ChatCompletionMessageParam) => {
                const content = typeof m.content === 'string'
                    ? m.content
                    : (Array.isArray(m.content) ? m.content.map(c => ((c as { text?: string }).text ?? '')).join('') : String(m.content))
                return {
                    role: m.role as 'user' | 'assistant' | 'system' | 'developer',
                    content
                }
            })

            const paramsObj = {
                model: model.family,
                input,
                stream: true,
                ...(tools && tools.length > 0 ? { tools, tool_choice: toolChoice as OpenAI.Responses.ToolChoiceOptions } : {}),
                ...(model.options?.reasoningEffort ? { reasoning_effort: model.options.reasoningEffort } : {})
            }

            const params = paramsObj as OpenAI.Responses.ResponseCreateParamsStreaming
            await this.createResponse(openai, params, progress, token)
        } else {
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
                model: model.family,
                messages: chatMessages,
            }
            if (tools && tools.length > 0) {
                params.tools = tools
                if (toolChoice) {
                    params.tool_choice = toolChoice
                }
            }
            if (model.options?.reasoningEffort) {
                params.reasoning_effort = model.options.reasoningEffort
            }
            if (this.streamSupported) {
                await this.createStream(openai, params, progress, token)
            } else {
                await this.createNonStream(openai, params, progress)
            }
        }
    }

    async createResponse(
        openai: OpenAI,
        params: OpenAI.Responses.ResponseCreateParams,
        progress: Progress<LanguageModelTextPart | LanguageModelToolCallPart>,
        token: CancellationToken
    ) {
        const newParams = { ...params, stream: true } satisfies OpenAI.Responses.ResponseCreateParamsStreaming
        debugObj('apiBaseUrl: ', this.apiBaseUrl, this.extension.outputChannel)
        debugObj('Chat params (responses): ', params, this.extension.outputChannel)
        const stream = openai.responses.stream(newParams)
        let allContent = ''
        const disposable = token.onCancellationRequested(() => {
            try {
                stream.controller?.abort()
            } catch {
                // ignore abort errors
            }
        })
        const itemIdToFunctionName = new Map<string, string>()
        stream.on('response.output_item.added', (evt) => {
            const item = evt.item
            if (item.type === 'function_call' && item.id) {
                itemIdToFunctionName.set(item.id, item.name)
            }
        })
        stream.on('response.output_text.delta', (evt) => {
            const content = evt.delta
            allContent += content ?? ''
            this.reportContent(content, progress)
        })
        stream.on('response.function_call_arguments.done', (evt) => {
            debugObj('ToolCall: ', evt, this.extension.outputChannel)
            const itemId = evt.item_id
            const fnName = itemIdToFunctionName.get(itemId)
            if (!fnName) {
                this.extension.outputChannel.error(`Could not determine function name for item_id: ${String(itemId)}`)
                return
            }
            const toolCall = {
                name: fnName,
                arguments: evt.arguments
            }
            this.reportToolCall(toolCall, progress)
        })
        await stream.finalResponse()
        disposable.dispose()
        debugObj('Chat reply (responses): ', allContent, this.extension.outputChannel)
    }

    async createStream(
        openai: OpenAI,
        params: OpenAI.Chat.Completions.ChatCompletionCreateParams,
        progress: Progress<LanguageModelTextPart | LanguageModelToolCallPart>,
        token: CancellationToken
    ) {
        const newParams = { ...params, stream: true } satisfies OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
        debugObj('apiBaseUrl: ', this.apiBaseUrl, this.extension.outputChannel)
        debugObj('Chat params: ', newParams, this.extension.outputChannel)
        const stream = openai.chat.completions.stream(newParams)
        let allContent = ''
        const disposable = token.onCancellationRequested(() => stream.controller.abort())
        stream.on('content', (content) => {
            allContent += content ?? ''
            this.reportContent(content, progress)
        })
        stream.on('tool_calls.function.arguments.done', (toolCall) => {
            debugObj('ToolCall: ', toolCall, this.extension.outputChannel)
            this.reportToolCall(toolCall, progress)
        })
        await stream.finalChatCompletion()
        disposable.dispose()
        debugObj('Chat reply: ', allContent, this.extension.outputChannel)
    }

    async createNonStream(
        openai: OpenAI,
        params: OpenAI.Chat.Completions.ChatCompletionCreateParams,
        progress: Progress<LanguageModelTextPart | LanguageModelToolCallPart>
    ) {
        const newParams = { ...params, stream: false } satisfies OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
        debugObj('Chat params: ', newParams, this.extension.outputChannel)
        const chatCompletion = await openai.chat.completions.create(newParams)
        const response = chatCompletion.choices[0]
        if (!response) {
            throw new Error('No response from OpenAI chat completion')
        }
        const content = response.message.content
        const toolCalls = response.message.tool_calls
        if (content) {
            debugObj('Chat reply: ', content, this.extension.outputChannel)
            this.reportContent(content, progress)
        }
        if (toolCalls) {
            for (const toolCall of toolCalls) {
                if (toolCall.type === 'function') {
                    this.reportToolCall(toolCall.function, progress)
                }
            }
        }
    }

    private reportContent(content: string | null | undefined, progress: Progress<LanguageModelTextPart>) {
        if (content) {
            progress.report(new LanguageModelTextPart(content))
        }
    }

    private reportToolCall(toolCall: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall.Function, progress: Progress<LanguageModelToolCallPart>) {
        if (toolCall.name === undefined || toolCall.arguments === undefined) {
            return
        }
        const callId = this.generateCallId()
        let args: object
        try {
            if (toolCall.arguments === '') {
                args = {}
            } else {
                args = JSON.parse(toolCall.arguments) as object
            }
        } catch (e) {
            this.extension.outputChannel.error(`Failed to parse tool call arguments: ${toolCall.arguments}. Error: ${e instanceof Error ? e.message : String(e)}`)
            return
        }
        const validator = getValidator(toolCall.name)
        if (validator === undefined) {
            this.extension.outputChannel.error(`No validator found for tool call: ${toolCall.name}`)
            throw new Error(`No validator found for tool call: ${toolCall.name}`)
        }
        if (!validator(args)) {
            this.extension.outputChannel.error(`Invalid tool call arguments for ${toolCall.name}: ${JSON.stringify(args)}`)
            throw new Error(`Invalid tool call arguments for ${toolCall.name}: ${JSON.stringify(args)}`)
        }
        progress.report(new LanguageModelToolCallPart(callId, toolCall.name, args))
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
                    if (typeof param.content === 'string') {
                        count += await this.tokenLength(param.content)
                    } else {
                        for (const c of param.content) {
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
