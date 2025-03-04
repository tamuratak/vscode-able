import { LanguageModelTextPart, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult } from 'vscode'
import { ChatHandleManager } from '../chat/chat.js'
import { getRangeToReplace } from './editlib/getrange.js'
import * as vscode from 'vscode'


interface EditInput {
    file?: string | undefined,
    textToReplace: string,
    input: string
}

interface CurrentInput extends EditInput {
    range: vscode.Range
    uri: vscode.Uri
}

const decoration = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgba(255, 0, 0, 0.3)',
    border: '1px solid red'
})

export class EditTool implements LanguageModelTool<EditInput> {
    private decorationDisposer?: (() => void) | undefined
    private currentInput: CurrentInput | undefined

    constructor(private readonly chatHandleManager: ChatHandleManager) { }

    invoke(options: LanguageModelToolInvocationOptions<EditInput>) {
        try {
            this.chatHandleManager.outputChannel.info(`EditTool input: ${JSON.stringify(options.input, null, 2)}`)
            const currentInput = this.currentInput
            if (!currentInput) {
                this.chatHandleManager.outputChannel.error('EditTool currentInput is undefined')
                return new LanguageModelToolResult([new LanguageModelTextPart('Edit failed')])
            }
            const { file, textToReplace, input } = options.input
            if (currentInput.file !== file || currentInput.textToReplace !== textToReplace || currentInput.input !== input) {
                this.chatHandleManager.outputChannel.error('EditTool currentInput is not same as options.input')
                return new LanguageModelToolResult([new LanguageModelTextPart('Edit failed')])
            }
            this.clearCurrentSession()
            // TODO: implement the edit
            return new LanguageModelToolResult([new LanguageModelTextPart('Edit succeeded')])
        } finally {
            this.clearCurrentSession()
        }
    }

    async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<EditInput>, token: vscode.CancellationToken) {

        this.chatHandleManager.outputChannel.info(`EditTool input: ${JSON.stringify(options.input, null, 2)}`)
        const uri = this.chatHandleManager.getChatSession()?.vscodeImplicitViewport?.uri
        if (!uri) {
            return undefined
        }
        const range = await this.getRangeToReplace(options.input.textToReplace)
        if (!range) {
            return undefined
        }
        const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString())
        if (!editor) {
            return undefined
        }
        this.setCurrentInput({ ...options.input, range, uri })
        editor.setDecorations(decoration, [range])
        this.setDecorationDisposer(() => editor.setDecorations(decoration, []))
        token.onCancellationRequested(() => this.clearCurrentSession())
        return {
            confirmationMessages: {
                title: 'Edit file?',
                message: new vscode.MarkdownString(`Edit file ${uri.toString()}?`)
            },
            invocationMessage: 'Editing file...'
        }
    }

    private setCurrentInput(input: CurrentInput) {
        this.currentInput = input
    }

    private clearCurrentSession() {
        this.decorationDisposer?.();
        this.decorationDisposer = undefined;
        this.currentInput = undefined
    }

    private setDecorationDisposer(disposer: () => void) {
        this.decorationDisposer = disposer
    }

    private async getRangeToReplace(textToReplace: string): Promise<vscode.Range | undefined> {
        const uri = this.chatHandleManager.getChatSession()?.vscodeImplicitViewport?.uri
        if (!uri) {
            return undefined
        }
        const document = await vscode.workspace.openTextDocument(uri)
        const ranges = getRangeToReplace(document, textToReplace)
        if (ranges.length === 1) {
            return ranges[0]
        }
        return undefined
    }

}
