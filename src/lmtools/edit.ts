import { LanguageModelTextPart, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult } from 'vscode'
import type { ChatHandleManager } from '../chat/chat.js'
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

    constructor(private readonly extension: {
        readonly outputChannel: vscode.LogOutputChannel
        readonly chatHandleManager: ChatHandleManager
    }) { }

    async invoke(options: LanguageModelToolInvocationOptions<EditInput>) {
        try {
            this.extension.outputChannel.info(`EditTool input: ${JSON.stringify(options.input, null, 2)}`)
            const currentInput = this.currentInput
            if (!currentInput) {
                this.extension.outputChannel.error('EditTool currentInput is undefined')
                return new LanguageModelToolResult([new LanguageModelTextPart('Edit failed')])
            }
            const { file, textToReplace, input } = options.input
            if (currentInput.file !== file || currentInput.textToReplace !== textToReplace || currentInput.input !== input) {
                this.extension.outputChannel.error('EditTool currentInput is not same as options.input')
                return new LanguageModelToolResult([new LanguageModelTextPart('Edit failed')])
            }
            this.clearCurrentSession()
            const { uri, range } = currentInput
            const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString())
            if (!editor) {
                this.extension.outputChannel.error('EditTool editor is undefined')
                return new LanguageModelToolResult([new LanguageModelTextPart('Edit failed')])
            }
            await editor.edit(editBuilder => {
                editBuilder.replace(range, input)
            })
            this.extension.outputChannel.info('EditTool edit was successful');
            return new LanguageModelToolResult([new LanguageModelTextPart('Edit succeeded')])
        } finally {
            this.clearCurrentSession()
        }
    }

    async prepareInvocation(options: vscode.LanguageModelToolInvocationPrepareOptions<EditInput>, token: vscode.CancellationToken) {
        this.clearCurrentSession()
        this.extension.outputChannel.info(`EditTool input: ${JSON.stringify(options.input, null, 2)}`)
        const uri = this.extension.chatHandleManager.getChatSession()?.vscodeImplicitReference?.uri
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
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter)
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

    clearCurrentSession() {
        this.decorationDisposer?.();
        this.decorationDisposer = undefined;
        this.currentInput = undefined
    }

    private setDecorationDisposer(disposer: () => void) {
        this.decorationDisposer = disposer
    }

    private async getRangeToReplace(textToReplace: string): Promise<vscode.Range | undefined> {
        const uri = this.extension.chatHandleManager.getChatSession()?.vscodeImplicitReference?.uri
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
