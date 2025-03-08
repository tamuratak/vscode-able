import * as vscode from 'vscode'
import type { HistoryEntry, InputProps } from '../prompt.js'
import { type PromptElementCtor, renderPrompt, type ToolCall } from '@vscode/prompt-tsx'
import { ExternalPromise } from '../../utils/externalpromise.js'
import { OpenAI } from 'openai'
import { Gpt4oTokenizer } from '../tokenizer.js'
import { convertToChatCompletionMessageParams } from './historyutils.js'
import type { Stream } from 'openai/streaming.mjs'
import type { ChatCompletionChunk, ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/index.mjs'
import { getLmTools } from './tools.js'
import type { EditTool } from '../../lmtools/edit.js'


export class OpenAiApiChatHandler {
    private readonly gpt4oTokenizer = new Gpt4oTokenizer()
    private readonly openAiClient = new ExternalPromise<OpenAI>()

    constructor(
        private readonly openAiServiceId: string,
        private readonly extension: {
            readonly outputChannel: vscode.LogOutputChannel,
            readonly editTool: EditTool
        }
    ) { }

    async resolveOpenAiClient() {
        if (!this.openAiClient.isResolved) {
            const session = await vscode.authentication.getSession(this.openAiServiceId, [], { createIfNone: true })
            const client = new OpenAI({ apiKey: session.accessToken })
            this.openAiClient.resolve(client)
        }
        return this.openAiClient.promise
    }

    async openAiGpt4oMiniResponse<S>(
        token: vscode.CancellationToken,
        request: vscode.ChatRequest,
        ctor: PromptElementCtor<InputProps, S>,
        ableHistory: HistoryEntry[],
        stream?: vscode.ChatResponseStream,
        prompt?: string
    ) {
        const client = await this.resolveOpenAiClient()
        const renderResult = await renderPrompt(ctor, { history: ableHistory, input: prompt ?? request.prompt }, { modelMaxPromptTokens: 2048 }, this.gpt4oTokenizer, undefined, undefined, 'none')
        const messages = convertToChatCompletionMessageParams(renderResult.messages)
        const abortController = new AbortController()
        const signal = abortController.signal
        token.onCancellationRequested(() => abortController.abort())
        const tools: ChatCompletionTool[] = []
        for (const tool of getLmTools()) {
            if (tool.inputSchema) {
                tools.push({
                    type: 'function',
                    function: {
                        name: tool.name,
                        description: tool.description,
                        parameters: tool.inputSchema as Record<string, unknown>,
                    }
                })
            }
        }
        const chatResponse = await client.chat.completions.create(
            { messages, model: 'gpt-4o-mini', max_completion_tokens: 2048, n: 1, stream: true, tools }, { signal }
        ).then(r => r, e => {
            if (e instanceof Error) {
                this.extension.outputChannel.error(e, messages)
            }
            throw e
        })
        if (stream) {
            await this.processOpenAiResponse(chatResponse, messages, token, request, stream, tools, signal)
            return { chatResponse: undefined }
        } else {
            return { chatResponse }
        }
    }

    private async processOpenAiResponse(
        chatResponse: Stream<ChatCompletionChunk>,
        messages: ChatCompletionMessageParam[],
        token: vscode.CancellationToken,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        tools: ChatCompletionTool[],
        signal: AbortSignal
    ) {
        const newMessages = [...messages]
        let responseStr = ''
        const toolCalls: ToolCall[] = []
        for await (const fragment of chatResponse) {
            const choice = fragment.choices[0]
            if (choice.delta.content) {
                stream.markdown(choice.delta.content)
                responseStr += choice.delta.content
            } else if (choice.delta.tool_calls) {
                for (const toolCall of choice.delta.tool_calls) {
                    if (!toolCall.function) {
                        continue
                    }
                    const { index } = toolCall
                    if (toolCalls[index]) {
                        toolCalls[index].function.arguments += toolCall.function.arguments
                    } else {
                        if (toolCall.function?.name && toolCall.id && toolCall.type) {
                            toolCalls[index] = { function: { name: toolCall.function.name, arguments: toolCall.function.arguments ?? '' }, id: toolCall.id, type: toolCall.type }
                        }
                    }

                }
            }
        }
        if (toolCalls.length > 0) {
            newMessages.push({ role: 'assistant', content: responseStr })
            for (const fragment of toolCalls) {
                const frag = { function: { name: fragment.function.name, arguments: fragment.function.arguments }, id: fragment.id, type: 'function' as const }
                const input = JSON.parse(fragment.function.arguments) as Record<string, unknown>
                const result = await vscode.lm.invokeTool(
                    fragment.function.name, { input, toolInvocationToken: request.toolInvocationToken }, token
                ).then(r => r, e => {
                    if (e instanceof Error) {
                        this.extension.outputChannel.error(e, fragment)
                    } else {
                        this.extension.outputChannel.error('Unknown error', e, fragment)
                    }
                    if (fragment.function.name === 'able_replace_text') {
                        this.extension.editTool.clearCurrentSession()
                    }
                    // TODO
                    throw e
                })
                if (result === undefined) {
                    continue
                }
                const ret: string[] = []
                for (const part of result.content) {
                    if (part instanceof vscode.LanguageModelTextPart) {
                        ret.push(part.value)
                    } else if (part instanceof vscode.LanguageModelPromptTsxPart) {
                        // TODO
                    }
                }
                newMessages.push({ role: 'assistant', content: '', tool_calls: [frag] })
                newMessages.push({ role: 'tool', content: ret.join(''), tool_call_id: fragment.id })
            }
            const client = await this.openAiClient.promise
            const chatResponse2 = await client.chat.completions.create(
                { messages: newMessages, model: 'gpt-4o-mini', max_completion_tokens: 2048, n: 1, stream: true, tools }, { signal }
            ).then(r => r, e => {
                if (e instanceof Error) {
                    this.extension.outputChannel.error(e, newMessages)
                }
                throw e
            })
            await this.processOpenAiResponse(chatResponse2, newMessages, token, request, stream, tools, signal)
        }
    }

}
