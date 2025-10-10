import * as vscode from 'vscode'
import { CancellationToken, LanguageModelChatMessage, LanguageModelChatProvider, LanguageModelDataPart, Progress, LanguageModelTextPart, LanguageModelChatInformation, LanguageModelToolCallPart, LanguageModelResponsePart2 } from 'vscode'
import OpenAI from 'openai'
import { getNonce } from '../../utils/getnonce.js'
import { getValidator, initValidators } from './toolcallargvalidator.js'
import { debugObj } from '../../utils/debug.js'
import { tokenLength } from './openaicompatchatproviderlib/tokencount.js'
import { Converter } from './openaicompatchatproviderlib/converter.js'
import { inspectReadable } from '../../utils/inspect.js'
import { renderMessages } from '../../utils/renderer.js'


export interface ModelInformation extends LanguageModelChatInformation {
    options?: {
        readonly reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
    } | undefined
}

export abstract class OpenAICompatChatProvider implements LanguageModelChatProvider {
    abstract readonly serviceName: string
    abstract readonly apiBaseUrl: string | undefined
    abstract readonly supported: {
        stream?: boolean | undefined
        response?: boolean | undefined
        file?: boolean | undefined
    }
    private readonly converter: Converter

    constructor(
        private readonly extension: {
            readonly outputChannel: vscode.LogOutputChannel,
        }
    ) {
        this.converter = new Converter(extension)
        setTimeout(() => this.extension.outputChannel.info(this.serviceName + ': OpenAICompatChatProvider initialized'), 0)
    }

    abstract get authServiceId(): string
    abstract get aiModelIds(): ModelInformation[]
    abstract get categoryLabel(): string

    private generateCallId(): string {
        return 'call_' + getNonce(16)
    }

    private createClient(apiKey: string) {
        return this.apiBaseUrl ? new OpenAI({ apiKey, baseURL: this.apiBaseUrl }) : new OpenAI({ apiKey })
    }

    async provideLanguageModelChatInformation(options: { silent: boolean; }): Promise<ModelInformation[]> {
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
                        requiresAuthorization: true
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
        options: vscode.ProvideLanguageModelChatResponseOptions,
        progress: Progress<LanguageModelResponsePart2>,
        token: CancellationToken
    ): Promise<void> {
        const session = await vscode.authentication.getSession(this.authServiceId, [], { silent: true })
        if (!session) {
            throw new Error('No authentication session found for ' + this.authServiceId)
        }
        const apiKey = session.accessToken
        const openai = this.createClient(apiKey)
        initValidators(options.tools)
        debugObj('OpenAI Compat (with Able) messages:\n', () => renderMessages(messages), this.extension.outputChannel)
        debugObj('apiBaseUrl: ', this.apiBaseUrl, this.extension.outputChannel)
        if (this.supported.response) {
            await this.responsesApiCall(openai, model, messages, options, progress, token)
        } else {
            await this.completionsApiCall(openai, model, messages, options, progress, token)
        }
    }

    private async responsesApiCall(
        openai: OpenAI,
        model: ModelInformation,
        messages: (LanguageModelChatMessage | vscode.LanguageModelChatMessage2)[],
        options: vscode.ProvideLanguageModelChatResponseOptions,
        progress: Progress<LanguageModelResponsePart2>,
        token: CancellationToken
    ) {
        const responseInput: OpenAI.Responses.ResponseInput
            = (await Promise.all(messages.map(async message => this.converter.toResponseCreateParams(message)))).flat()
        const tools: OpenAI.Responses.Tool[] | undefined = options.tools?.map(tool => ({
            type: 'function',
            name: tool.name,
            description: tool.description ?? null,
            parameters: tool.inputSchema ? tool.inputSchema as Record<string, unknown> : null,
            strict: true
        }))
        const toolChoice = options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : (tools && tools.length > 0 ? 'auto' : undefined)
        const hasTools = tools && tools.length > 0
        const baseParams: OpenAI.Responses.ResponseCreateParams = {
            model: model.family,
            input: responseInput,
            ...(hasTools ? { tools } : {}),
            ...(hasTools && toolChoice ? { tool_choice: toolChoice } : {}),
            ...(model.options?.reasoningEffort ? { reasoning: { effort: model.options.reasoningEffort } } : {})
        }
        if (this.supported.stream) {
            await this.createResponsesStream(openai, baseParams, progress, token)
        } else {
            throw new Error('Non-streaming responses are not supported yet')
        }
    }

    private async createResponsesStream(
        openai: OpenAI,
        params: OpenAI.Responses.ResponseCreateParams,
        progress: Progress<LanguageModelResponsePart2>,
        token: CancellationToken
    ) {
        const streamingParams = { ...params, stream: true } satisfies OpenAI.Responses.ResponseCreateParamsStreaming
        const stream = openai.responses.stream(streamingParams)
        let allReasoning = ''
        let allContent = ''
        const disposable = token.onCancellationRequested(() => stream.abort())
        stream.on('response.output_text.delta', (event) => {
            allContent += event.delta
            this.reportContent(event.delta, progress)
        })
        stream.on('response.output_item.done', (event) => {
            const item = event.item
            if (item.type === 'function_call') {
                const toolCall: OpenAI.Responses.ResponseFunctionToolCall = {
                    type: 'function_call',
                    call_id: item.call_id,
                    name: item.name,
                    arguments: item.arguments
                }
                this.reportToolCall(toolCall, progress)
            } else if (item.type === 'reasoning') {
                const summaryArray = item.summary.map(s => s.text)
                allReasoning += summaryArray.join(' ')
                progress.report(new vscode.ChatResponseThinkingProgressPart(summaryArray, item.id))
            }
        })
        try {
            await stream.finalResponse()
        } finally {
            disposable.dispose()
        }
        debugObj('Chat reply: ', allReasoning + '\n\n' + allContent, this.extension.outputChannel)
    }

    private async completionsApiCall(
        openai: OpenAI,
        model: ModelInformation,
        messages: (LanguageModelChatMessage | vscode.LanguageModelChatMessage2)[],
        options: vscode.ProvideLanguageModelChatResponseOptions,
        progress: Progress<LanguageModelResponsePart2>,
        token: CancellationToken
    ) {
        const chatMessages: OpenAI.Chat.ChatCompletionMessageParam[]
            = (await Promise.all(messages.map(m => this.converter.toChatCompletionMessageParam(m)))).flat()
        const tools: OpenAI.Chat.ChatCompletionTool[] | undefined = options.tools?.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.inputSchema as Record<string, unknown>
            }
        }))
        const toolChoice = options.toolMode === vscode.LanguageModelChatToolMode.Required ? 'required' : (tools ? 'auto' : undefined)
        const hasTools = tools && tools.length > 0
        const params: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
            model: model.family,
            messages: chatMessages,
            ...(hasTools ? { tools } : {}),
            ...(hasTools && toolChoice ? { tool_choice: toolChoice } : {}),
            ...(model.options?.reasoningEffort ? { reasoning_effort: model.options.reasoningEffort } : {})
        }
        if (this.supported.stream) {
            await this.createStream(openai, params, progress, token)
        } else {
            await this.createNonStream(openai, params, progress)
        }
    }

    private async createStream(
        openai: OpenAI,
        params: OpenAI.Chat.Completions.ChatCompletionCreateParams,
        progress: Progress<LanguageModelTextPart | LanguageModelToolCallPart | LanguageModelDataPart>,
        token: CancellationToken
    ) {
        const newParams = { ...params, stream: true } satisfies OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming
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
        try {
            await stream.finalChatCompletion()
        } finally {
            disposable.dispose()
        }
        debugObj('Chat reply: ', allContent, this.extension.outputChannel)
    }

    private async createNonStream(
        openai: OpenAI,
        params: OpenAI.Chat.Completions.ChatCompletionCreateParams,
        progress: Progress<LanguageModelTextPart | LanguageModelToolCallPart | LanguageModelDataPart>
    ) {
        const newParams = { ...params, stream: false } satisfies OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming
        // debugObj('Chat params: ', newParams, this.extension.outputChannel)
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

    private reportContent(content: string | null | undefined, progress: Progress<LanguageModelTextPart | LanguageModelToolCallPart | LanguageModelDataPart>) {
        if (content) {
            progress.report(new LanguageModelTextPart(content))
        }
    }

    private reportToolCall(
        toolCall: OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta.ToolCall.Function | OpenAI.Responses.ResponseFunctionToolCall,
        progress: Progress<LanguageModelTextPart | LanguageModelToolCallPart | LanguageModelDataPart>
    ) {
        if (toolCall.name === undefined || toolCall.arguments === undefined) {
            return
        }
        const callId = 'call_id' in toolCall && toolCall.call_id ? toolCall.call_id : this.generateCallId()
        let args: object
        try {
            if (toolCall.arguments === '') {
                args = {}
            } else {
                args = JSON.parse(toolCall.arguments) as object
            }
        } catch (e) {
            this.extension.outputChannel.error(`Failed to parse tool call arguments: ${toolCall.arguments}. Error: ${e instanceof Error ? e.message : inspectReadable(e)}`)
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
        return tokenLength(text)
    }

}
