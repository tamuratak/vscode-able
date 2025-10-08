import * as vscode from 'vscode'
import type { ToolCallResultPair, ToolCallResultRoundProps } from '../prompt.js'
import { BasePromptElementProps, type PromptElementCtor, renderPrompt } from '@vscode/prompt-tsx'
import { AbleTool, convertToToolCall, getLmTools } from './toolutils.js'
import { renderMessages } from '../utils/renderer.js'


export class CopilotChatHandler {

    constructor(private readonly extension: {
        readonly outputChannel: vscode.LogOutputChannel
    }) { }

    async copilotChatResponse<P extends BasePromptElementProps, S>(
        token: vscode.CancellationToken,
        request: vscode.ChatRequest,
        ctor: PromptElementCtor<P, S>,
        props: P,
        model: vscode.LanguageModelChat,
        stream?: vscode.ChatResponseStream,
        selectedTools?: readonly AbleTool[]
    ) {
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
            const tools = getLmTools(selectedTools)
            this.extension.outputChannel.debug('@able messages:\n' + await renderMessages(messages))
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
