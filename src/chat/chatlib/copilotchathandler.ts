import * as vscode from 'vscode'
import { ToolResultDirectivePrompt } from '../prompt.js'
import { type BasePromptElementProps, type PromptElementCtor, renderPrompt } from '@vscode/prompt-tsx'
import { getLmTools } from './tools.js'
import type { EditTool } from '../../lmtools/edit.js'


export class CopilotChatHandler {
    copilotModelFamily = 'gpt-4o-mini'

    constructor(readonly extension: {
        readonly outputChannel: vscode.LogOutputChannel
        readonly editTool: EditTool
    }) { }

    async copilotChatResponse<P extends BasePromptElementProps, S>(
        token: vscode.CancellationToken,
        request: vscode.ChatRequest,
        ctor: PromptElementCtor<P, S>,
        props: P,
        stream?: vscode.ChatResponseStream,
        model?: vscode.LanguageModelChat,
    ) {
        if (!model) {
            [model] = await vscode.lm.selectChatModels({
                vendor: 'copilot',
                family: this.copilotModelFamily
            })
        }
        if (!model) {
            void vscode.window.showErrorMessage('Copilot model is not loaded. Execute the activation command.')
            throw new Error('Copilot model is not loaded')
        }
        const { messages } = await renderPrompt(ctor, props, { modelMaxPromptTokens: 2048 }, model)
        this.extension.outputChannel.info('Copilot chat response', JSON.stringify(messages, null, 2))
        const tools = getLmTools()
        const chatResponse = await model.sendRequest(
            messages, { tools }, token
        ).then(r => r, e => {
            if (e instanceof Error) {
                this.extension.outputChannel.error(e, messages)
            }
            throw e
        })
        if (stream) {
            await this.processChatResponse(chatResponse, messages, token, request, stream, tools, model)
            return { chatResponse: undefined, messages: undefined, tools, model }
        } else {
            return { chatResponse, messages, tools, model }
        }
    }

    private async processChatResponse(
        chatResponse: vscode.LanguageModelChatResponse,
        messages: vscode.LanguageModelChatMessage[],
        token: vscode.CancellationToken,
        request: vscode.ChatRequest,
        stream: vscode.ChatResponseStream,
        tools: vscode.LanguageModelChatTool[],
        model: vscode.LanguageModelChat,
    ): Promise<void> {
        const newMessages = [...messages]
        let responseStr = ''
        const toolCalls: vscode.LanguageModelToolCallPart[] = []
        for await (const fragment of chatResponse.stream) {
            if (fragment instanceof vscode.LanguageModelTextPart) {
                stream.markdown(fragment.value)
                responseStr += fragment.value
            } else if (fragment instanceof vscode.LanguageModelToolCallPart) {
                toolCalls.push(fragment)
            }
        }
        if (toolCalls.length > 0) {
            newMessages.push(vscode.LanguageModelChatMessage.Assistant(responseStr))
            for (const fragment of toolCalls) {
                const result = await vscode.lm.invokeTool(
                    fragment.name,
                    { input: fragment.input, toolInvocationToken: request.toolInvocationToken }, token
                ).then(r => r, e => {
                    if (e instanceof Error) {
                        this.extension.outputChannel.error(e, fragment)
                    } else {
                        this.extension.outputChannel.error('Unknown error', e, fragment)
                    }
                    if (fragment.name === 'able_replace_text') {
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
                const toolResultPart = new vscode.LanguageModelToolResultPart(fragment.callId, [new vscode.LanguageModelTextPart(ret.join(''))])
                newMessages.push(
                    vscode.LanguageModelChatMessage.Assistant([fragment]),
                    vscode.LanguageModelChatMessage.User([toolResultPart]),
                )
            }
            const directive = await renderPrompt(ToolResultDirectivePrompt, { messages: newMessages }, { modelMaxPromptTokens: 2048 }, model)
            const chatResponse2 = await model.sendRequest(
                directive.messages, { tools }, token
            ).then(r => r, e => {
                if (e instanceof Error) {
                    this.extension.outputChannel.error(e, directive.messages)
                }
                throw e
            })
            await this.processChatResponse(chatResponse2, directive.messages, token, request, stream, tools, model)
        }
    }

}
