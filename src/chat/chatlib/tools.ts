import * as vscode from 'vscode'

export const ableTools = ['able_python', 'able_edit']

export function getLmTools() {
    const tools: vscode.LanguageModelChatTool[] = []
    const availableTools = vscode.lm.tools.filter(tool => ableTools.includes(tool.name))
    for (const tool of availableTools) {
        if (tool.inputSchema) {
            tools.push({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })
        }
    }
    return tools
}
