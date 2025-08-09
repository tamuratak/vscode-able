import * as vscode from 'vscode'
import { CancellationToken, ChatResponseFragment2, LanguageModelChatMessage, LanguageModelChatMessageRole, LanguageModelChatProvider2, LanguageModelChatRequestHandleOptions, Progress, LanguageModelTextPart, LanguageModelChatInformation, LanguageModelToolCallPart } from 'vscode'
import OpenAI from 'openai'
import { Gpt4oTokenizer } from '../tokenizer.js'
import { Raw } from '@vscode/prompt-tsx'
import { Stream } from 'openai/streaming.js'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions/completions.js'
import type { ChatCompletionAssistantMessageParam, ChatCompletionMessageToolCall, ChatCompletionToolMessageParam } from 'openai/resources.mjs'
import { OpenAI as PromptOpenAI } from '@vscode/prompt-tsx'
import { openaiAuthServiceId } from '../auth/authproviders.js'
import { getNonce } from '../../utils/getnonce.js'
import { renderToolResult } from '../../utils/toolresult.js'


type OpenAIChatInformation = LanguageModelChatInformation & {
    model: string
}

export interface FunctionToolCall {
    id?: string;
    function?: {
        arguments?: string;
        name?: string;
    }
    type?: 'function';
}

export class OpenAIChatProvider implements LanguageModelChatProvider2<OpenAIChatInformation> {
    private readonly aiModelIds = [
        'gpt-4o',
        'gpt-4-turbo',
        'gpt-4',
        'gpt-3.5-turbo'
    ]

    constructor(
        private readonly extension: {
            readonly outputChannel: vscode.LogOutputChannel,
        }
    ) {
        this.extension.outputChannel.info('OpenAIChatProvider initialized')
    }

    generateCallId(): string {
        return 'call_' + getNonce(16)
    }

    async prepareLanguageModelChat(options: { silent: boolean; }): Promise<OpenAIChatInformation[]> {
        try {
            const session = await vscode.authentication.getSession(openaiAuthServiceId, [], { silent: options.silent })
            if (!session) {
                return []
            }
            const apiKey = session.accessToken
            const openai = new OpenAI({ apiKey })
            const models = await openai.models.list()
            const result: OpenAIChatInformation[] = []
            for (const model of models.data) {
                if (!this.aiModelIds.includes(model.id)) {
                    continue
                }
                result.push({
                    id: model.id,
                    category: {
                        label: 'OpenAI',
                        order: 1001
                    },
                    cost: 'OpenAI',
                    name: model.id,
                    family: model.id,
                    version: model.id,
                    maxInputTokens: 0,
                    maxOutputTokens: 0,
                    description: model.id,
                    auth: true,
                    capabilities: {
                        toolCalling: true
                    },
                    model: model.id
                })
            }
            return result
        } catch (e) {
            this.extension.outputChannel.error(`Failed to prepare OpenAI chat: ${JSON.stringify(e)}`)
            return []
        }
    }

    async provideLanguageModelChatResponse(
        model: OpenAIChatInformation,
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
            model: model.model,
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

    async provideTokenCount(_model: OpenAIChatInformation, text: string | LanguageModelChatMessage | vscode.LanguageModelChatMessage2): Promise<number> {
        const tokenizer = new Gpt4oTokenizer()
        if (typeof text === 'string') {
            // Use tokenLength for string part
            return tokenizer.tokenLength({ type: Raw.ChatCompletionContentPartKind.Text, text })
        } else {
            let content = ''
            for (const part of text.content) {
                if (part instanceof LanguageModelTextPart) {
                    content += part.value
                }
            }
            if (text.role === LanguageModelChatMessageRole.User) {
                const msg: import('@vscode/prompt-tsx').OpenAI.UserChatMessage = { role: PromptOpenAI.ChatRole.User, content }
                return tokenizer.countMessageTokens(msg)
            } else if (text.role === LanguageModelChatMessageRole.Assistant) {
                const msg: import('@vscode/prompt-tsx').OpenAI.AssistantChatMessage = { role: PromptOpenAI.ChatRole.Assistant, content }
                return tokenizer.countMessageTokens(msg)
            } else if (text.role === LanguageModelChatMessageRole.System) {
                const msg: import('@vscode/prompt-tsx').OpenAI.SystemChatMessage = { role: PromptOpenAI.ChatRole.System, content }
                return tokenizer.countMessageTokens(msg)
            } else {
                return 0
            }
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
