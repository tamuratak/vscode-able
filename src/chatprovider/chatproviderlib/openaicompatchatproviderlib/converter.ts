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
            } else if (part instanceof vscode.LanguageModelToolResultPart2 || part instanceof vscode.LanguageModelToolResultPart) {
                // TODO: an element of part contents is LanguageModelDataPart case
                const contents = part.content.filter(c => c instanceof LanguageModelTextPart || c instanceof vscode.LanguageModelPromptTsxPart)
                const toolResult = new vscode.LanguageModelToolResult(contents)
                const content = await renderToolResult(toolResult)
                result.push({
                    role: 'tool',
                    tool_call_id: part.callId,
                    content
                } satisfies OpenAI.Chat.ChatCompletionToolMessageParam)
            } else if (part instanceof vscode.LanguageModelDataPart) {
                if (message.role === LanguageModelChatMessageRole.Assistant) {
                    continue
                }
                if (part.mimeType.startsWith('image/')) {
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
                    result.push({
                        role: 'user',
                        content: [{
                            type: 'file',
                            file: {
                                file_data: Buffer.from(part.data).toString('base64'),
                            }
                        }]
                    })

                }
            } else {
                // TODO: LanguageModelThinkingPart case
                part satisfies vscode.LanguageModelThinkingPart
                this.extension.outputChannel.info('Skipping LanguageModelThinkingPart')
            }
        }
        if (message.role === LanguageModelChatMessageRole.Assistant) {
            return [{
                role: 'assistant',
                content: assistantContent,
                ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
            }] satisfies OpenAI.Chat.ChatCompletionAssistantMessageParam[]
        } else {
            return result
        }
    }

    async toResponseCreateParams(
        message: LanguageModelChatMessage | vscode.LanguageModelChatMessage2
    ): Promise<OpenAI.Responses.ResponseInputItem[]> {
        const input: OpenAI.Responses.ResponseInput = []
        const role =
            message.role === LanguageModelChatMessageRole.Assistant
                ? 'assistant'
                : message.role === LanguageModelChatMessageRole.System
                    ? 'developer'
                    : 'user'
        for (const part of message.content) {
            if (part instanceof LanguageModelTextPart) {
                input.push({
                    type: 'message',
                    role,
                    content: part.value,
                } satisfies OpenAI.Responses.EasyInputMessage)
            } else if (part instanceof LanguageModelToolCallPart) {
                input.push({
                    type: 'function_call',
                    name: part.name,
                    arguments: JSON.stringify(part.input),
                    call_id: part.callId,
                } satisfies OpenAI.Responses.ResponseFunctionToolCall)
            } else if (part instanceof vscode.LanguageModelToolResultPart2 || part instanceof vscode.LanguageModelToolResultPart) {
                // TODO: an element of part contents is LanguageModelDataPart case
                const contents = part.content.filter(c => c instanceof LanguageModelTextPart || c instanceof vscode.LanguageModelPromptTsxPart)
                const toolResult = new vscode.LanguageModelToolResult(contents)
                const output = await renderToolResult(toolResult)
                input.push({
                    type: 'function_call_output',
                    call_id: part.callId,
                    output,
                } satisfies OpenAI.Responses.ResponseInputItem.FunctionCallOutput)
            } else if (part instanceof vscode.LanguageModelDataPart) {
                if (part.mimeType.startsWith('image/')) {
                    input.push({
                        type: 'message',
                        role,
                        content: [{
                            type: 'input_image',
                            detail: 'auto',
                            image_url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString('base64')}`,
                        }]
                    } satisfies OpenAI.Responses.EasyInputMessage)
                } else {
                    input.push({
                        type: 'message',
                        role,
                        content: [{
                            type: 'input_file',
                            file_data: Buffer.from(part.data).toString('base64')
                        }]
                    } satisfies OpenAI.Responses.EasyInputMessage)
                }
            } else if (part instanceof vscode.LanguageModelThinkingPart) {
                if (part.id) {
                    const summaryText = typeof part.value === 'string' ? part.value : part.value.join('\n')
                    const summary: OpenAI.Responses.ResponseReasoningItem.Summary[] = [{
                        type: 'summary_text',
                        text: summaryText
                    }]
                    input.push({
                        type: 'reasoning',
                        id: part.id,
                        summary
                    } satisfies OpenAI.Responses.ResponseReasoningItem)
                }
            }
        }
        return input
    }
}
