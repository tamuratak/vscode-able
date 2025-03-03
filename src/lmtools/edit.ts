import { LanguageModelTextPart, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult } from 'vscode'
import { ChatHandleManager } from '../chat/chat.js'

interface EditInput {
    file?: string | undefined,
    textToReplace: string,
    input: string
}

export class EditTool implements LanguageModelTool<EditInput[]> {

    constructor(private readonly chatHandleManager: ChatHandleManager) { }

    invoke(options: LanguageModelToolInvocationOptions<EditInput[]>) {
        for (const input of options.input) {
            this.chatHandleManager.outputChannel.info(`EditTool input: ${JSON.stringify(input)}`)
        }
        return new LanguageModelToolResult([new LanguageModelTextPart('Edit succeeded')])
    }

}
