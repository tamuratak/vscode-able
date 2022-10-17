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

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100.45)
    vscode.window.onDidChangeTextEditorSelection((event) => {
        const document = event.textEditor.document
        const cursor = event.selections?.[0].start
        if (cursor) {
            const offset = document.offsetAt(cursor)
            statusBarItem.text = `offset: ${offset}`
        }
    })
    vscode.window.onDidChangeActiveTextEditor((event) => {
        if (event?.document.uri.scheme !== 'file') {
            statusBarItem.hide()
        } else {
            statusBarItem.show()
        }
    })
    const cursor = vscode.window.activeTextEditor?.selection.start
    if (cursor) {
        const offset = vscode.window.activeTextEditor?.document.offsetAt(cursor)
        statusBarItem.text = `offset: ${offset}`
    }
    statusBarItem.show()
}
