import * as vscode from 'vscode'


export function getLmTools() {
    const tools: vscode.LanguageModelChatTool[] = []
    const ablePython = vscode.lm.tools.find(tool => tool.name === 'able_python')
    if (ablePython && ablePython.inputSchema) {
        tools.push({ name: ablePython.name, description: ablePython.description, inputSchema: ablePython.inputSchema })
    }
    return tools
}
