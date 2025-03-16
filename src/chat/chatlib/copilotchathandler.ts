import * as vscode from 'vscode'
import type { MainPromptProps, ToolCallResultPair, ToolCallResultRoundProps } from '../prompt.js'
import { type PromptElementCtor, renderPrompt } from '@vscode/prompt-tsx'
import { AbleTool, convertToToolCall, getLmTools } from './toolutils.js'
import type { EditTool } from '../../lmtools/edit.js'


export class CopilotChatHandler {
    copilotModelFamily = 'gpt-4o-mini'

    constructor(private readonly extension: {
        readonly outputChannel: vscode.LogOutputChannel
        readonly editTool: EditTool
    }) { }

    async copilotChatResponse<P extends MainPromptProps, S>(
        token: vscode.CancellationToken,
        request: vscode.ChatRequest,
        ctor: PromptElementCtor<P, S>,
        props: P,
        stream?: vscode.ChatResponseStream,
        model?: vscode.LanguageModelChat,
        selectedTools?: readonly AbleTool[]
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
        // Send requests to the LLM repeatedly until there are no more tool calling requests in the LLM's response.
        // toolCallResultRounds contains the tool calling requests made up to that point and their results.
        const toolCallResultRounds: ToolCallResultRoundProps[] = []
        let count = 0
        while (true) {
            if (count > 10) {
                this.extension.outputChannel.error('Too many iterations')
                throw new Error('Too many iterations')
            }
            count += 1
            const { messages } = await renderPrompt(
                ctor,
                { ...props, toolCallResultRounds },
                { modelMaxPromptTokens: model.maxInputTokens * 0.8 },
                model // model.countTokens is used to calculate the token count of the prompt.
            )
            this.extension.outputChannel.debug('Copilot chat response', JSON.stringify(messages, null, 2))
            const tools = getLmTools(selectedTools)
            // Send request to the LLM.
            const chatResponse = await model.sendRequest(
                messages, { tools }, token
            ).then(r => r, e => {
                if (e instanceof Error) {
                    this.extension.outputChannel.error(e, messages)
                }
                throw e
            })
            if (!stream) {
                return { chatResponse }
            }
            let responseStr = ''
            // Collecting the requests of tool calling from the response.
            const toolCalls: vscode.LanguageModelToolCallPart[] = []
            for await (const fragment of chatResponse.stream) {
                if (fragment instanceof vscode.LanguageModelTextPart) {
                    stream.markdown(fragment.value)
                    responseStr += fragment.value
                } else if (fragment instanceof vscode.LanguageModelToolCallPart) {
                    toolCalls.push(fragment)
                }
            }
            const toolCallResultPairs: ToolCallResultPair[] = []
            if (toolCalls.length === 0) {
                return
            }
            // Processing the tool calling requests.
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
                    // When edit canceled, or edit failed.
                    if (fragment.name === 'able_replace_text') {
                        this.extension.editTool.clearCurrentSession()
                        // TODO
                        // check if the error is EditToolError class
                        // if range or uri is undefined, tell LLM to retry with a new better request. return LanguageModelToolResult.
                        // else throw error.
                    }
                    throw e
                })
                if (result === undefined) {
                    continue
                }
                // Collect results after processing tool calls.
                toolCallResultPairs.push({ toolCall: convertToToolCall(fragment), toolResult: result })
            }
            // Save the tool calling requests and their results for the next iteration.
            // The next iteration will be called with the tool calling requests and their results.
            // LLM will use them to generate the next response.
            toolCallResultRounds.push({ responseStr, toolCallResultPairs })
        }
    }

}
