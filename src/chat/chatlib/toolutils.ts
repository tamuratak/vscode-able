import type { ToolCall } from '@vscode/prompt-tsx'
import * as vscode from 'vscode'

export const ableTools = ['able_python', 'able_replace_text'] as const
export type AbleTool = typeof ableTools[number]

export function getLmTools(selectedTools: readonly AbleTool[] = ableTools): vscode.LanguageModelChatTool[] {
    const tools: vscode.LanguageModelChatTool[] = []
    const availableTools = vscode.lm.tools.filter(tool => selectedTools.includes(tool.name as AbleTool))
    for (const tool of availableTools) {
        if (tool.inputSchema) {
            tools.push({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })
        }
    }
    return tools
}

export function convertToToolCall(tc: vscode.LanguageModelToolCallPart): ToolCall {
    return {
        type: 'function',
        function: {
            name: tc.name,
            arguments: JSON.stringify(tc.input)
        },
        id: tc.callId
    }
}
