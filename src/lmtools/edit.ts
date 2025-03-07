import { LanguageModelTextPart, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult } from 'vscode'
import { getRangeToReplace } from './editlib/getrange.js'
import * as vscode from 'vscode'
import { findWorkspaceFileUri } from '../utils/uri.js'


interface EditInput {
    file: string,
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

class EditToolError extends Error {
    constructor(
        message: string,
        public readonly errorResult: {
            type: 'uri_is_undefined' | 'range_not_found' | 'editor_not_found' | 'current_input_not_same' | 'current_input_is_undefined'
            uri: vscode.Uri | undefined
            range: vscode.Range | undefined
        },
    ) {
        super(message)
    }
}

export class EditTool implements LanguageModelTool<EditInput> {
    private decorationDisposer?: (() => void) | undefined
    private currentInput: CurrentInput | undefined

    constructor(private readonly extension: {
        readonly outputChannel: vscode.LogOutputChannel
    }) { }

    async invoke(options: LanguageModelToolInvocationOptions<EditInput>) {
        try {
            this.extension.outputChannel.debug(`EditTool input: ${JSON.stringify(options.input, null, 2)}`)
            const currentInput = this.currentInput
            if (!currentInput) {
                this.extension.outputChannel.error('EditTool currentInput is undefined')
                throw new EditToolError('EditTool currentInput is undefined', {
                    type: 'current_input_is_undefined',
                    uri: undefined,
                    range: undefined,
                })
            }
            const { file, textToReplace, input } = options.input
            if (currentInput.file !== file || currentInput.textToReplace !== textToReplace || currentInput.input !== input) {
                this.extension.outputChannel.error('EditTool currentInput is not same as options.input')
                throw new EditToolError('EditTool currentInput is not same as options.input', {
                    type: 'current_input_not_same',
                    uri: currentInput.uri,
                    range: currentInput.range,
                })
            }
            this.clearCurrentSession()
            const { uri, range } = currentInput
            const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString())
            if (!editor) {
                this.extension.outputChannel.error('EditTool editor is undefined')
                throw new EditToolError('EditTool editor is undefined', {
                    type: 'editor_not_found',
                    uri,
                    range,
                })
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
        this.extension.outputChannel.debug(`EditTool input: ${JSON.stringify(options.input, null, 2)}`)
        const uri = await findWorkspaceFileUri(options.input.file)
        if (!uri) {
            const message = `findWorkspaceFileUri Cannot find file: ${options.input.file}`
            this.extension.outputChannel.error(message)
            throw new EditToolError(message, {
                type: 'uri_is_undefined',
                uri,
                range: undefined,
            })
        }
        const range = await this.getRangeToReplace(uri, options.input.textToReplace)
        if (!range) {
            const message = 'Range to replace cannot be determined'
            this.extension.outputChannel.error(message)
            throw new EditToolError(message, {
                type: 'range_not_found',
                uri,
                range,
            })
        }
        const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString())
        if (!editor) {
            const message = `Cannot find editor for ${uri.toString()}`
            this.extension.outputChannel.error(message)
            throw new EditToolError(message, {
                type: 'editor_not_found',
                uri,
                range,
            })
        }
        this.setCurrentInput({ ...options.input, range, uri })
        editor.setDecorations(decoration, [range])
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter)
        this.setDecorationDisposer(() => editor.setDecorations(decoration, []))
        token.onCancellationRequested(() => this.clearCurrentSession())
        return {
            confirmationMessages: {
                title: 'Edit file?',
                message: new vscode.MarkdownString(`Edit file ${uri.toString()}\n\n\`\`\`${editor.document.languageId}\n${options.input.input}\n\`\`\``),
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

    private async getRangeToReplace(uri: vscode.Uri, textToReplace: string): Promise<vscode.Range | undefined> {
        const document = await vscode.workspace.openTextDocument(uri)
        const ranges = getRangeToReplace(document, textToReplace)
        if (ranges.length === 1) {
            return ranges[0]
        }
        return undefined
    }

}

/*
    "startOffset": {
        "type": "number",
            "description": "The start offset of the text to replace. If the range to be replaced begins at the start of the file, this should be 0. You can use able_count_characters to get the offset. This is optional."
    },
    "endOffset": {
        "type": "number",
            "description": "The end offset of the text to replace. This should reference the position after the last character that you want to replace. This is optional."
    }
*/
