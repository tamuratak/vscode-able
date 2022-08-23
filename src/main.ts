import * as vscode from 'vscode'

export function activate() {
    let terminalIsVisible = false
    vscode.commands.registerCommand('able.toggleTerminalAndSideBar', async () => {
        await vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility')
        if (terminalIsVisible) {
            vscode.window.activeTerminal?.show()
            await vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal')
            terminalIsVisible = false
        } else {
            await vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal')
            terminalIsVisible = true
        }
    })
}
