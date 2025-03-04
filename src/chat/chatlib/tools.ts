import * as vscode from 'vscode'

export const ableTools = ['able_python', 'able_replace_text', 'able_count_characters'] as const
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
