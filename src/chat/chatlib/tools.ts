import * as vscode from 'vscode'

export const availableTools = ['able_python', 'able_edit']

export function getLmTools() {
    const tools: vscode.LanguageModelChatTool[] = []
    const ablePython = vscode.lm.tools.find(tool => availableTools.includes(tool.name))
    if (ablePython && ablePython.inputSchema) {
        tools.push({ name: ablePython.name, description: ablePython.description, inputSchema: ablePython.inputSchema })
    }
    return tools
}
