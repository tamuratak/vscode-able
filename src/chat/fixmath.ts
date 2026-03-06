import * as vscode from 'vscode'
import { processReferences } from './chatlib/referenceutils.js'
import { doFixMath } from './fixmathlib/fix.js'


export class FixMathChatHandleManager {

    constructor(
        readonly extension: {
            readonly outputChannel: vscode.LogOutputChannel,
        }
    ) {

    }

    getHandler(): vscode.ChatRequestHandler {
        return async (
            request: vscode.ChatRequest,
            _context: vscode.ChatContext,
            stream: vscode.ChatResponseStream
        ): Promise<vscode.ChatResult | undefined> => {
            const { files } = await processReferences(request.references)
            const attachments = files.filter(ref => ref.kind === 'file')
            const decoder = new TextDecoder()
            for (const attachment of attachments) {
                const uri = attachment.uri
                try {
                    const buf = await vscode.workspace.fs.readFile(uri)
                    const content = decoder.decode(buf)
                    const fixedContent = doFixMath(content)
                    const edit = new vscode.TextEdit(
                        new vscode.Range(
                            new vscode.Position(0, 0),
                            new vscode.Position(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)
                        ),
                        fixedContent
                    )
                    stream.textEdit(uri, edit)
                } catch {
                    this.extension.outputChannel.error(`Failed to read or process file ${uri.toString()}`)
                }
            }
            return
        }
    }

}
