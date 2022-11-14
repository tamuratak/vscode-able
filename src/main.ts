import * as vscode from 'vscode'

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

class Extension {

    constructor() {
        this.registerTerminalAndSideBarCommand()
        this.registerFocusTerminalCommand()
        this.registerShowingOffset()
        this.registerHighlightCursor()
    }

    registerTerminalAndSideBarCommand() {
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

    registerFocusTerminalCommand() {
        let ableTerminal: vscode.Terminal | undefined
        vscode.commands.registerCommand('able.focusTerminal', () => {
            if (ableTerminal && ableTerminal.exitStatus === undefined) {
                ableTerminal.show()
            } else {
                ableTerminal = undefined
                if (vscode.window.tabGroups.all.length === 1) {
                    vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal')
                } else {
                    vscode.commands.executeCommand('able.terminalNew')
                }
            }
        })

        vscode.commands.registerCommand('able.terminalNew', () => {
            setActiveDocument(vscode.window.activeTextEditor?.document)
            if (vscode.window.tabGroups.all.length > 1) {
                ableTerminal = vscode.window.createTerminal({ location: { viewColumn: vscode.ViewColumn.One } })
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
                const tabGroup = vscode.window.tabGroups.all.find((group) => group.tabs.find((tab) => {
                    if (tab.input instanceof vscode.TabInputText) {
                        if (tab.input.uri.toString() === activeDocument?.uri.toString()) {
                            return tab
                        }
                    }
                    return
                }))
                vscode.window.showTextDocument(activeDocument, tabGroup?.viewColumn)
            }
        })

        vscode.workspace.onDidOpenTextDocument((doc) => {
            setActiveDocument(doc)
        })

        vscode.window.onDidChangeActiveTextEditor((editor) => {
            setActiveDocument(editor?.document)
        })
    }

    registerShowingOffset() {
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

    highlightCursor(editor: vscode.TextEditor) {
        const cursor = editor.selection.active
        const decoConfig: vscode.DecorationRenderOptions = {
            borderWidth: '1px',
            borderStyle: 'solid',
            light: {
                borderColor: 'red'
            },
            dark: {
                borderColor: 'white'
            },
            isWholeLine: true
        }
        const deco = vscode.window.createTextEditorDecorationType(decoConfig)
        editor.setDecorations(deco, [new vscode.Range(cursor, cursor)])
        setTimeout(() => { deco.dispose() }, 1000)

    }

    registerHighlightCursor() {
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            setTimeout(() => {
                if (editor) {
                    this.highlightCursor(editor)
                }
            }, 300)
        })
    }

}

export function activate() {
    new Extension()
}
