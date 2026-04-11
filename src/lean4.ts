import * as vscode from 'vscode'
import { sleep } from './utils/utils.js'


export class Lean4Extension implements vscode.Disposable {
    private readonly disposables: vscode.Disposable[] = []
    constructor(readonly extension: {
        readonly outputChannel: vscode.LogOutputChannel
    }) {
        this.disposables.push(
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
        )
    }

    dispose() {
        for (const d of this.disposables) {
            d.dispose()
        }
    }

}
