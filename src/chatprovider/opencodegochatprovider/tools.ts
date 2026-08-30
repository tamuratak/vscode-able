// import * as vscode from 'vscode'
import { CancellationToken, LanguageModelChatInformation, LanguageModelChatMessageRole, LanguageModelChatRequestMessage, LanguageModelResponsePart2, LanguageModelTextPart, LanguageModelToolCallPart, Progress, ProvideLanguageModelChatResponseOptions } from 'vscode'
import { MessagesResult } from './anthropic/anthropicApi.js'
import { ChatCompletionsResult } from './openai/openaiApi.js'
import { ResponsesResult } from './openai/openaiResponsesApi.js'
import { getNonce } from '../../utils/getnonce.js'


export function tweakTools(options: ProvideLanguageModelChatResponseOptions) {
    const { tools } = options

    // https://github.com/microsoft/vscode/blob/4b04bed81a929b4603b508ce4a21993ae5fee2af/extensions/copilot/package.json#L1234
    // run_in_terminal: https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/chat/common/tools/terminalToolIds.ts (TerminalToolId.RunInTerminal).
    // Removed so the model always uses VS Code Able's able_runInSandbox tool instead.
    const toolsToRemove = ['session_store_sql', 'run_in_terminal']
    const newTools = tools?.filter(tool => !toolsToRemove.includes(tool.name)) ?? []

    return { ...options, tools: newTools }

}

export function pushToolCall(
    _model: LanguageModelChatInformation,
    messages: readonly LanguageModelChatRequestMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    progress: Progress<LanguageModelResponsePart2>,
    _token: CancellationToken,
    responseResult: ChatCompletionsResult | MessagesResult | ResponsesResult | undefined
) {
    let isToolCallFinish = false
    if (responseResult) {
        if (responseResult.apiType === 'chat-completions') {
            isToolCallFinish = responseResult.finishReason === 'tool_calls'
        } else if (responseResult.apiType === 'responses') {
            isToolCallFinish = responseResult.finishReason === 'tool_calls'
        } else {
            isToolCallFinish = responseResult.stopReason === 'tool_use'
        }
    }
    if (!isToolCallFinish) {
        return
    }
    const hasReadFile = options.tools?.some(tool => tool.name === 'read_file')
    const lastMessage = messages[messages.length - 1]
    if (lastMessage?.role === LanguageModelChatMessageRole.User) {
        for (const part of lastMessage.content) {
            if (part instanceof LanguageModelTextPart && hasReadFile) {
                const text = part.value
                const editorContextRegex = /<editorContext>\nThe user's current file is (.*?). The current selection is from line (\d+) to line (\d+).\n<\/editorContext>/
                const match = editorContextRegex.exec(text)
                if (match) {
                    const filePath = match[1]
                    const startLine = parseInt(match[2], 10)
                    const endLine = parseInt(match[3], 10)
                    progress.report(
                        new LanguageModelToolCallPart(
                            'call_' + getNonce(16),
                            'read_file',
                            { filePath, startLine, endLine }
                        )
                    )
                }
            }
        }
    }
}

