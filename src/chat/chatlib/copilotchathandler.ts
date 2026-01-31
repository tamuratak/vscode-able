import * as vscode from 'vscode'
import type { ToolCallResultPair, ToolCallResultRoundProps } from '../prompt.js'
import { BasePromptElementProps, type PromptElementCtor, renderPrompt } from '@vscode/prompt-tsx'
import { convertToToolCall } from './toolutils.js'
import { renderMessages } from '../../utils/renderer.js'
import { debugObj } from '../../utils/debug.js'


export class CopilotChatHandler {

    constructor(private readonly extension: {
        readonly outputChannel: vscode.LogOutputChannel
    }) { }

    /**
     * Handles a chat response with GitHub Copilot Chat.
     *
     * Tool calls are ignored in this implementation.
     *
     * @returns A promise that resolves to a chat result containing the final chat response, or undefined if stream is provided.
     */
    async copilotChatResponse<P extends BasePromptElementProps, S>(
        token: vscode.CancellationToken,
        ctor: PromptElementCtor<P, S>,
        props: P,
        model: vscode.LanguageModelChat,
        stream?: vscode.ChatResponseStream
    ) {
        // Send requests to the LLM repeatedly until there are no more tool calling requests in the LLM's response.
        // toolCallResultRounds contains the tool calling requests made up to that point and their results.
        const toolCallResultRounds: ToolCallResultRoundProps[] = []
        let count = 0
        while (true) {
            if (count > 2) {
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
            debugObj('@able messages:\n', () => renderMessages(messages), this.extension.outputChannel)
            // Send request to the LLM.
            const chatResponse = await model.sendRequest(
                messages, { }, token
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
                } else if (fragment instanceof vscode.LanguageModelThinkingPart) {
                    // Ignoring thinking parts for now.
                    // stream.thinkingProgress({ text: fragment.value, ...fragment })
                }
            }
            const toolCallResultPairs: ToolCallResultPair[] = []
            if (toolCalls.length === 0) {
                return
            }
            // Processing the tool calling requests.
            for (const fragment of toolCalls) {
                // Collect results after processing tool calls.
                toolCallResultPairs.push(
                    {
                        toolCall: convertToToolCall(fragment),
                        toolResult: new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart('tool is not implemented')])
                    }
                )

            }
            // Save the tool calling requests and their results for the next iteration.
            // The next iteration will be called with the tool calling requests and their results.
            // LLM will use them to generate the next response.
            toolCallResultRounds.push({ responseStr, toolCallResultPairs })
        }
    }

}
