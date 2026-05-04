import * as vscode from 'vscode'
import { LanguageModelChatMessage, LanguageModelChatMessageRole, LanguageModelTextPart, LanguageModelToolCallPart } from 'vscode'
import { ModelMessage, AssistantModelMessage, ToolCallPart, ToolModelMessage } from 'ai'
import { renderToolResult } from '../../utils/toolresultrendering.js'
import { isSupportedMimeType } from './mime.js'
import { debugObj } from '../../utils/debug.js'


export class OpenCodeGoChatConverter {
    constructor(
        private readonly extension: {
            readonly outputChannel: vscode.LogOutputChannel,
        },
        private readonly callIdToolNameMap: Map<string, string>
    ) { }

    async toChatCompletionMessageParam(
        message: LanguageModelChatMessage | vscode.LanguageModelChatMessage2
    ): Promise<ModelMessage[]> {
        const result: ModelMessage[] = []
        const assistantContent: AssistantModelMessage['content'] = []
        const toolCalls: ToolCallPart[] = []
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
                    type: 'tool-call',
                    toolName: part.name,
                    toolCallId: part.callId,
                    input: part.input
                })
            } else if (part instanceof vscode.LanguageModelToolResultPart2 || part instanceof vscode.LanguageModelToolResultPart) {
                // TODO: an element of part contents is LanguageModelDataPart case
                const contents = part.content.filter(c => c instanceof LanguageModelTextPart || c instanceof vscode.LanguageModelPromptTsxPart)
                const toolResult = new vscode.LanguageModelToolResult(contents)
                const content = await renderToolResult(toolResult)
                const toolName = this.callIdToolNameMap.get(part.callId)
                if (!toolName) {
                    this.extension.outputChannel.error(`No tool name found for tool call id: ${part.callId}`)
                    continue
                }
                result.push({
                    role: 'tool',
                    content: [
                        {
                            type: 'tool-result',
                            toolName,
                            toolCallId: part.callId,
                            output: {
                                type: 'text',
                                value: content
                            }
                        }
                    ]
                } satisfies ToolModelMessage)
            } else if (part instanceof vscode.LanguageModelDataPart) {
                if (message.role === LanguageModelChatMessageRole.Assistant) {
                    continue
                }
                const mimeType = part.mimeType
                const isAllowed = isSupportedMimeType(mimeType)
                if (!isAllowed) {
                    this.extension.outputChannel.error(`Unsupported mimeType in LanguageModelDataPart: ${mimeType}`)
                    continue
                }
                if (mimeType.startsWith('image/')) {
                    result.push({
                        role: 'user',
                        content: [{
                            type: 'image',
                            image: `data:${part.mimeType};base64,${Buffer.from(part.data).toString('base64')}`
                        }]
                    })
                } else {
                    result.push({
                        role: 'user',
                        content: [{
                            type: 'file',
                            data: Buffer.from(part.data).toString('base64'),
                            mediaType: part.mimeType
                        }]
                    })

                }
            } else if (part instanceof vscode.LanguageModelThinkingPart) {
                for (const text of part.value) {
                    assistantContent.push({
                        type: 'reasoning',
                        text
                    })
                }
            } else {
                part satisfies never
                debugObj('Unknown message part: ', part, this.extension.outputChannel)
            }
        }
        if (message.role === LanguageModelChatMessageRole.Assistant) {
            return [{
                role: 'assistant',
                content: assistantContent,
                ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
            }]
        } else {
            return result
        }
    }

}
