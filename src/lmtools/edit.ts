import { LanguageModelTextPart, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult } from 'vscode'
import { ChatHandler } from '../chat/chat.js'

interface EditInput {
    textToReplace: string,
    input: string
}

export class EditTool implements LanguageModelTool<EditInput[]> {
    private readonly chatHandler: ChatHandler

    constructor(chatHandler: ChatHandler) {
        this.chatHandler = chatHandler
    }

    invoke(options: LanguageModelToolInvocationOptions<EditInput[]>) {
        const result: LanguageModelTextPart[] = []
        for (const input of options.input) {
            result.push(new LanguageModelTextPart(input.textToReplace))
            result.push(new LanguageModelTextPart(input.input))
        }
        return new LanguageModelToolResult(result)
    }

}
