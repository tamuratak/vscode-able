import * as vscode from 'vscode'
import { sleep } from './utils/utils.js'

vscode.languages.onDidChangeDiagnostics(async event => {
    for (const uri of event.uris) {
        const diagnostics = vscode.languages.getDiagnostics(uri)
        for (const diagnostic of diagnostics) {
            if (diagnostic.message.includes('use the "Restart File" command')) {
                const activeEdit = vscode.window.activeTextEditor?.document.uri
                await vscode.window.showTextDocument(uri)
                await sleep(100)
                await vscode.commands.executeCommand('lean4.restartFile')
                await sleep(100)
                if (activeEdit) {
                    await vscode.window.showTextDocument(activeEdit)
                }
                break
            }
        }
    }
})
