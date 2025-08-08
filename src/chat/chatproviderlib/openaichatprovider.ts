import * as vscode from 'vscode'
import { CancellationToken, ChatResponseFragment2, LanguageModelChatMessage, LanguageModelChatMessageRole, LanguageModelChatProvider2, LanguageModelChatRequestHandleOptions, Progress, LanguageModelTextPart, LanguageModelChatInformation, LanguageModelToolCallPart } from 'vscode'
import OpenAI from 'openai'
import { Gpt4oTokenizer } from '../tokenizer.js'
import { Raw } from '@vscode/prompt-tsx'
import type { Stream } from 'openai/streaming'
import type { ChatCompletionChunk, ChatCompletionMessageParam, ChatCompletionTool, ChatCompletionRole } from 'openai/resources/chat/completions/completions.js'
import { OpenAI as PromptOpenAI } from '@vscode/prompt-tsx'
import { openaiAuthServiceId } from '../auth/authproviders.js'
import { getNonce } from '../../utils/getnonce.js'

type OpenAIChatInformation = LanguageModelChatInformation & {
    model: string
}

const toolCallIdNameMap = new Map<string, string>()

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
        const chatMessages: ChatCompletionMessageParam[] = messages.map(m => {
            let role: ChatCompletionRole = 'user'
            if (m.role === LanguageModelChatMessageRole.Assistant) { role = 'assistant' }
            else if (m.role === LanguageModelChatMessageRole.User) { role = 'user' }
            else if (m.role === LanguageModelChatMessageRole.System) { role = 'system' }
            let content = ''
            for (const part of m.content) {
                if (part instanceof LanguageModelTextPart) {
                    content += part.value
                }
            }
            return { role, content }
        })
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
        for await (const chunk of stream as Stream<ChatCompletionChunk>) {
            if (token.isCancellationRequested) {
                break
            }
            const choice = chunk.choices[0]
            if (choice.delta?.content) {
                progress.report({
                    index: 0,
                    part: new LanguageModelTextPart(choice.delta.content)
                } satisfies ChatResponseFragment2)
            }
            if (choice.delta?.tool_calls) {
                for (const call of choice.delta.tool_calls) {
                    if (!call.function || !call.id) { continue }
                    const callId: string = call.id ?? this.generateCallId()
                    const callName: string = call.function?.name ?? 'unknown_function'
                    toolCallIdNameMap.set(callId, callName)
                    const toolArgs = call.function?.arguments ? JSON.parse(call.function.arguments) as object : undefined
                    if (!toolArgs) {
                        throw new Error(`Failed to parse tool arguments for call ${callId}`)
                    }
                    progress.report({
                        index: 0,
                        part: new LanguageModelToolCallPart(callId, callName, toolArgs)
                    })
                }
            }
        }
    }

    async provideTokenCount(_model: OpenAIChatInformation, text: string | LanguageModelChatMessage | vscode.LanguageModelChatMessage2): Promise<number> {
        const tokenizer = new Gpt4oTokenizer()
        if (typeof text === 'string') {
            // Use tokenLength for string part
            // Use the correct enum for type
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


    convertLanguageModelChatMessageToContent(message: LanguageModelChatMessage | vscode.LanguageModelChatMessage2): { role: string, content: string } {
        let content = ''
        for (const part of message.content) {
            if (part instanceof LanguageModelTextPart) {
                content += part.value
            }
        }
        const role = message.role === LanguageModelChatMessageRole.Assistant ? 'assistant' : message.role === LanguageModelChatMessageRole.User ? 'user' : 'system'
        return { role, content }
    }

}
