import * as vscode from 'vscode'

export function activate() {
    vscode.commands.registerCommand('able.toggleTerminalAndSideBar', async () => {
        await vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility')
        await vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal')
    })
}
