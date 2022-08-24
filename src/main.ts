import * as vscode from 'vscode'

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

export function activate() {
    vscode.commands.registerCommand('able.closeTerminalAndOpenSideBar', async () => {
        await vscode.commands.executeCommand('workbench.action.focusSideBar')
        await sleep(10)
        await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar')
        await vscode.commands.executeCommand('workbench.action.closePanel')
    })
    vscode.commands.registerCommand('able.openTerminalAndCloseSideBar', async () => {
        await vscode.commands.executeCommand('workbench.action.closeSidebar')
        await sleep(10)
        await vscode.commands.executeCommand('terminal.focus')
        vscode.window.activeTerminal?.show()
    })
}
