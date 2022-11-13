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
    vscode.commands.registerCommand('able.focusTerminal', () => {
        vscode.window.activeTerminal?.show()
    })

    vscode.commands.registerCommand('able.terminalNew', () => {
        setActiveDocument(vscode.window.activeTextEditor?.document)
        if (vscode.window.tabGroups.all.length > 1) {
            vscode.window.createTerminal({location: { viewColumn: vscode.ViewColumn.One }})
        } else {
            vscode.commands.executeCommand('workbench.action.terminal.new')
        }
    })

    let activeDocument: vscode.TextDocument | undefined
    const setActiveDocument = (doc: vscode.TextDocument | undefined) => {
        if (doc?.uri.scheme !== 'file') {
            return
        }
        activeDocument = doc
    }

    vscode.commands.registerCommand('able.focusActiveDocument', () => {
        if (activeDocument) {
            vscode.window.showTextDocument(activeDocument)
        }
    })

    vscode.workspace.onDidOpenTextDocument((doc) => {
        setActiveDocument(doc)
    })

    vscode.window.onDidChangeActiveTextEditor((editor) => {
        setActiveDocument(editor?.document)
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
