import { LanguageModelTextPart, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult } from 'vscode'

export interface TextInput {
    input: string
}

export class CountTool implements LanguageModelTool<TextInput> {

    invoke(options: LanguageModelToolInvocationOptions<TextInput>) {
        const { input } = options.input
        return new LanguageModelToolResult([new LanguageModelTextPart(input.length.toString())])
    }

}
