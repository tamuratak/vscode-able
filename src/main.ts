import * as vscode from 'vscode'

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

export function activate() {
    let terminalIsVisible = false
    vscode.commands.registerCommand('able.toggleTerminalAndSideBar', async () => {
        await vscode.commands.executeCommand('workbench.action.toggleSidebarVisibility')
        if (terminalIsVisible) {
            vscode.window.activeTerminal?.show()
            await sleep(10)
            await vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal')
            terminalIsVisible = false
        } else {
            await vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal')
            terminalIsVisible = true
        }
    })
}
