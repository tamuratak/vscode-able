import { LanguageModelTextPart, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult } from 'vscode'
import { ChatHandleManager } from '../chat/chat.js'
import { getRangeToReplace } from './editlib/getrange.js'
import * as vscode from 'vscode'


interface EditInput {
    file?: string | undefined,
    textToReplace: string,
    input: string
}

const decoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 0, 0, 0.3)',
    border: '1px solid red'
})

export class EditTool implements LanguageModelTool<EditInput> {
    private decorationDisposer?: (() => void) | undefined

    constructor(private readonly chatHandleManager: ChatHandleManager) { }

    invoke(options: LanguageModelToolInvocationOptions<EditInput>, token: vscode.CancellationToken) {
        token.onCancellationRequested(() => this.disposeDecoration())
        this.chatHandleManager.outputChannel.info(`EditTool input: ${JSON.stringify(options.input, null, 2)}`)
        const uri = this.chatHandleManager.getChatSession()?.vscodeImplicitViewport?.uri
        if (!uri) {
            throw new Error('No chat session')
        }
        //        const document = await vscode.workspace.openTextDocument(uri)
        //        const range = await this.getRangeToReplace(options.input.textToReplace)
        this.disposeDecoration()
        return new LanguageModelToolResult([new LanguageModelTextPart('Edit succeeded')])
    }

    async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<EditInput>, token: vscode.CancellationToken) {
        this.chatHandleManager.outputChannel.info(`EditTool input: ${JSON.stringify(options.input, null, 2)}`)
        const uri = this.chatHandleManager.getChatSession()?.vscodeImplicitViewport?.uri
        if (!uri) {
            throw new Error('No chat session')
        }
        const range = await this.getRangeToReplace(options.input.textToReplace)
        const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString())

        if (!editor) {
            throw new Error('Editor not found for the specified document')
        }
        editor.setDecorations(decoration, [range])
        this.setDecorationDisposer(() => editor.setDecorations(decoration, []))
        token.onCancellationRequested(() => this.disposeDecoration())
        return {
            confirmationMessages: {
                title: 'Edit file?',
                message: new vscode.MarkdownString(`Edit file ${uri.toString()}?`)
            },
            invocationMessage: 'Editing file...'
        }
    }

    private disposeDecoration() {
        this.decorationDisposer?.();
        this.decorationDisposer = undefined;
    }

    private setDecorationDisposer(disposer: () => void) {
        this.decorationDisposer = disposer
    }

    async getRangeToReplace(textToReplace: string) {
        const uri = this.chatHandleManager.getChatSession()?.vscodeImplicitViewport?.uri
        if (!uri) {
            throw new Error('No chat session')
        }
        const document = await vscode.workspace.openTextDocument(uri)
        const ranges = getRangeToReplace(document, textToReplace)
        if (ranges.length > 1) {
            throw new Error('Multiple ranges found')
        }
        return ranges[0]
    }

}
