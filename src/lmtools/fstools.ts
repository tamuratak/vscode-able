import { LanguageModelTextPart, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult } from 'vscode'
import * as vscode from 'vscode'
import { findWorkspaceFileUri } from '../utils/uri.js'

interface ReadFileInput {
    path: string
}

export class ReadFileTool implements LanguageModelTool<ReadFileInput> {

    constructor(private readonly extension: {
        readonly outputChannel: vscode.LogOutputChannel
    }) { }

    async invoke(options: LanguageModelToolInvocationOptions<ReadFileInput>) {
        this.extension.outputChannel.debug(`ReadFileTool input: ${JSON.stringify(options.input, null, 2)}`)
        const uri = await findWorkspaceFileUri(options.input.path)
        if (!uri) {
            const message = `ReadFileTool uri is undefined: ${options.input.path}`
            this.extension.outputChannel.error(message)
            throw new Error(message)
        }
        const fileUint8Array = await vscode.workspace.fs.readFile(uri)
        const fileText = new TextDecoder().decode(fileUint8Array)
        return new LanguageModelToolResult([new LanguageModelTextPart(fileText)])
    }

}
