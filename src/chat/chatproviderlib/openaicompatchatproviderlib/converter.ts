import * as vscode from 'vscode'
import { LanguageModelChatMessage, LanguageModelChatMessageRole, LanguageModelTextPart, LanguageModelToolCallPart } from 'vscode'
import OpenAI from 'openai'
import { renderToolResult } from '../../../utils/toolresultrendering.js'


export class Converter {
    constructor(
        private readonly extension: {
            readonly outputChannel: vscode.LogOutputChannel,
        }
    ) { }

    async toChatCompletionMessageParam(
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
            } else if (part instanceof vscode.LanguageModelDataPart) {
                if (part.mimeType.startsWith('image/') && message.role !== LanguageModelChatMessageRole.Assistant) {
                    result.push({
                        role: 'user',
                        content: [{
                            type: 'image_url',
                            image_url: {
                                url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString('base64')}`
                            }
                        }]
                    })
                } else {
                    // TODO: support other data parts
                    this.extension.outputChannel.info(`Skipping LanguageModelDataPart with mimeType ${part.mimeType}`)
                }
            } else {
                // TODO: LanguageModelThinkingPart case
                part satisfies vscode.LanguageModelThinkingPart
                this.extension.outputChannel.info('Skipping LanguageModelThinkingPart')
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

    async toResponseCreateParams(
        message: LanguageModelChatMessage | vscode.LanguageModelChatMessage2
    ): Promise<OpenAI.Responses.ResponseCreateParams[]> {
        const input: OpenAI.Responses.ResponseInput = []

        // Build the message content array for a single message input item
        const messageContent: OpenAI.Responses.ResponseInputMessageContentList = []

        // Map vscode role -> Responses role. LanguageModelChatMessageRole.Assistant
        // isn't supported as an input role, map it to 'developer' as a best-effort.
        const role: 'user' | 'system' | 'developer' =
            message.role === LanguageModelChatMessageRole.System
                ? 'system'
                : message.role === LanguageModelChatMessageRole.User
                    ? 'user'
                    : 'developer'

        for (const part of message.content) {
            if (part instanceof LanguageModelTextPart) {
                messageContent.push({ type: 'input_text', text: part.value })
            } else if (part instanceof LanguageModelToolCallPart) {
                // Represent a tool/function call as a top-level function_call input item
                const funcCall: OpenAI.Responses.ResponseFunctionToolCall = {
                    type: 'function_call',
                    name: part.name,
                    arguments: JSON.stringify(part.input),
                    call_id: part.callId,
                }
                input.push(funcCall)
            } else if ((part instanceof vscode.LanguageModelToolResultPart2) || (part instanceof vscode.LanguageModelToolResultPart)) {
                const contents = part.content.filter(c => c instanceof LanguageModelTextPart || c instanceof vscode.LanguageModelPromptTsxPart)
                const toolResult = new vscode.LanguageModelToolResult(contents)
                const rendered = await renderToolResult(toolResult)
                const textItem: OpenAI.Responses.ResponseInputText = { type: 'input_text', text: rendered }
                messageContent.push(textItem)
            } else if (part instanceof vscode.LanguageModelDataPart) {
                if (part.mimeType.startsWith('image/')) {
                    const imageItem: OpenAI.Responses.ResponseInputImage = {
                        type: 'input_image',
                        detail: 'auto',
                        image_url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString('base64')}`,
                    }
                    messageContent.push(imageItem)
                } else {
                    this.extension.outputChannel.info(`Skipping LanguageModelDataPart with mimeType ${part.mimeType}`)
                }
            } else {
                // Thinking parts and others aren't represented in Responses input
                part satisfies vscode.LanguageModelThinkingPart
                this.extension.outputChannel.info('Skipping LanguageModelThinkingPart')
            }
        }

        // Always include the message item (even if empty content)
        const messageItem: OpenAI.Responses.ResponseInputItem.Message = {
            type: 'message',
            role,
            content: messageContent,
        }
        input.push(messageItem)

        // Return a single ResponseCreateParams. Caller can augment with model/tools/etc.
        return [{ input }]
    }
}
