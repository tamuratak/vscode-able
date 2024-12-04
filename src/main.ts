import * as vscode from 'vscode'
import { handler } from './chat/chat'

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

class Extension {

    registerCommands() {
        return [
            ...this.registerTerminalAndSideBarCommand(),
            ...this.registerFocusTerminalCommand(),
            ...this.registerShowingOffset(),
            ...this.registerRecenterCommand(),
            ...this.registerKillLinesToEndCommand(),
            ...this.registerDisableInlineSuggestCommand()
        ]
    }

    private registerTerminalAndSideBarCommand() {
        return [
            vscode.commands.registerCommand('able.closeTerminalAndOpenSideBar', async () => {
                await vscode.commands.executeCommand('workbench.action.focusSideBar')
                await sleep(10)
                await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar')
                await vscode.commands.executeCommand('workbench.action.closePanel')
            }),
            vscode.commands.registerCommand('able.openTerminalAndCloseSideBar', async () => {
                await vscode.commands.executeCommand('workbench.action.closeSidebar')
                await sleep(10)
                await vscode.commands.executeCommand('terminal.focus')
                vscode.window.activeTerminal?.show()
            })
        ]
    }

    private registerFocusTerminalCommand() {
        let ableTerminal: vscode.Terminal | undefined
        let activeDocument: vscode.TextDocument | undefined
        const setActiveDocument = (doc: vscode.TextDocument | undefined) => {
            if (doc?.uri.scheme !== 'file') {
                return
            }
            activeDocument = doc
        }

        return [
            vscode.commands.registerCommand('able.focusTerminal', () => {
                if (ableTerminal && ableTerminal.exitStatus === undefined) {
                    ableTerminal.show()
                } else {
                    ableTerminal = undefined
                    if (vscode.window.tabGroups.all.length === 1) {
                        void vscode.commands.executeCommand('workbench.action.terminal.toggleTerminal')
                    } else {
                        void vscode.commands.executeCommand('able.terminalNew')
                    }
                }
            }),
            vscode.commands.registerCommand('able.terminalNew', () => {
                setActiveDocument(vscode.window.activeTextEditor?.document)
                if (vscode.window.tabGroups.all.length > 1) {
                    ableTerminal = vscode.window.createTerminal({ location: { viewColumn: vscode.ViewColumn.One } })
                    ableTerminal.sendText(' export PROMPT="%{$fg[red]%}%B[%l)%b %2~% ]$ "')
                    ableTerminal.sendText(' clear')
                } else {
                    void vscode.commands.executeCommand('workbench.action.terminal.new')
                }
            }),
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
                    return vscode.window.showTextDocument(activeDocument, tabGroup?.viewColumn)
                }
                return
            }),
            vscode.workspace.onDidOpenTextDocument((doc) => {
                setActiveDocument(doc)
            }),
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                setActiveDocument(editor?.document)
            })
        ]
    }

    private registerShowingOffset() {
        const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100.45)
        const cursor = vscode.window.activeTextEditor?.selection.start
        if (cursor) {
            const offset = vscode.window.activeTextEditor?.document.offsetAt(cursor)
            statusBarItem.text = `offset: ${offset}`
        }
        statusBarItem.show()
        return [
            statusBarItem,
            vscode.window.onDidChangeTextEditorSelection((event) => {
                const document = event.textEditor.document
                const activeCursor = event.selections?.[0].start
                if (activeCursor) {
                    const offset = document.offsetAt(activeCursor)
                    statusBarItem.text = `offset: ${offset}`
                }
            }),
            vscode.window.onDidChangeActiveTextEditor((event) => {
                if (event?.document.uri.scheme !== 'file') {
                    statusBarItem.hide()
                } else {
                    statusBarItem.show()
                }
            })
        ]
    }

    private registerRecenterCommand() {
        return [
            vscode.commands.registerCommand('able.recenter', async () => {
                await vscode.commands.executeCommand('able.focusActiveDocument')
                const editor = vscode.window.activeTextEditor
                const cursor = editor?.selection.active
                if (editor && cursor) {
                    await vscode.window.showTextDocument(editor.document)
                    editor.revealRange(new vscode.Range(cursor, cursor), vscode.TextEditorRevealType.InCenter)
                    this.highlightCursor(editor)
                }
            })
        ]
    }

    private highlightCursor(editor: vscode.TextEditor) {
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
        setTimeout(() => deco.dispose(), 500)
    }

    private registerKillLinesToEndCommand() {
        return [
            vscode.commands.registerTextEditorCommand('able.killLinesToEnd', async (textEditor, edit) => {
                const document = textEditor.document
                const killedLines: string[] = []
                textEditor.selections.forEach((selection) => {
                    if (selection.isEmpty) {
                        const cursor = selection.active
                        const currentLine = textEditor.document.lineAt(cursor.line)
                        const lineRange = currentLine.range
                        if (cursor.character === lineRange.end.character) {
                            const deleteRange = new vscode.Range(cursor.line, cursor.character, cursor.line + 1, 0)
                            edit.delete(deleteRange)
                        } else {
                            const deleteRange = new vscode.Range(cursor, lineRange.end)
                            killedLines.push(document.getText(deleteRange))
                            edit.delete(deleteRange)
                        }
                    } else {
                        killedLines.push(document.getText(selection))
                        edit.delete(selection)
                    }
                })
                const eol = document.eol === vscode.EndOfLine.LF ? '\n' : '\r\n'
                if (killedLines.length > 0) {
                    await vscode.env.clipboard.writeText(killedLines.join(eol))
                }
            })
        ]
    }

    private registerDisableInlineSuggestCommand() {
        return [
            vscode.commands.registerCommand('able.disableInlineSuggest', () => {
                const configuration = vscode.workspace.getConfiguration('editor')
                void configuration.update('inlineSuggest.enabled', false, vscode.ConfigurationTarget.Global)
                void vscode.commands.executeCommand('editor.action.inlineSuggest.hide')
                setTimeout(() => {
                    void configuration.update('inlineSuggest.enabled', true, vscode.ConfigurationTarget.Global)
                }, 10000)
            })
        ]
    }

}

export function activate(context: vscode.ExtensionContext) {
    vscode.chat.createChatParticipant('able.chatParticipant', handler)
    const extension = new Extension()
    context.subscriptions.push(...extension.registerCommands())

    context.environmentVariableCollection.delete('GIT_INDEX_FILE')
    if (vscode.env.appName.includes('Insiders')) {
        context.environmentVariableCollection.replace('GIT_EDITOR', 'codeInsiders -nw')
    } else {
        context.environmentVariableCollection.replace('GIT_EDITOR', 'vscode -nw')
    }

}
