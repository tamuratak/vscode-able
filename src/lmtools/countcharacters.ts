import * as vscode from 'vscode'
import { LanguageModelTextPart, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult } from 'vscode'

export interface TextInput {
    input: string
}

export class CountTool implements LanguageModelTool<TextInput> {

    constructor(private readonly extension: {
        readonly outputChannel: vscode.LogOutputChannel
    }) { }

    invoke(options: LanguageModelToolInvocationOptions<TextInput>) {
        const { input } = options.input
        this.extension.outputChannel.debug(`CountTool input: ${JSON.stringify(options.input, null, 2)}`)
        return new LanguageModelToolResult([new LanguageModelTextPart(input.length.toString())])
    }

}
