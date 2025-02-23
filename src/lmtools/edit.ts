// import { CancellationToken, LanguageModelTextPart, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolInvocationPrepareOptions, LanguageModelToolResult, MarkdownString, PreparedToolInvocation, ProviderResult, Uri } from 'vscode'
import * as vscode from 'vscode'
/*
interface EditInput {
    uri: Uri
    input: string
}

export class EditTool implements LanguageModelTool<EditInput> {
    invoke(options: LanguageModelToolInvocationOptions<EditInput>, token: CancellationToken): ProviderResult<LanguageModelToolResult> {

    }

    prepareInvocation(options: LanguageModelToolInvocationPrepareOptions<EditInput>, token: CancellationToken): ProviderResult<PreparedToolInvocation> {

    }

}
*/

export function getRangeToReplace(document: vscode.TextDocument, input: string) {
    const inputLines = input.split('\n')
    const docLineCount = document.lineCount

    // Find the start position by matching the first 3 lines of input with document
    let startLine = 0
    let startMatch = false
    while (startLine < docLineCount - 2) {
        if (document.lineAt(startLine).text === inputLines[0] &&
            document.lineAt(startLine + 1).text === inputLines[1] &&
            document.lineAt(startLine + 2).text === inputLines[2]) {
            startMatch = true
            break
        }
        startLine++
    }

    // Find the end position by matching the last 3 lines of input with document
    let endLine = docLineCount - 1
    let endMatch = false
    let inputEndLine = inputLines.length - 1
    while (endLine >= 2) {
        if (document.lineAt(endLine).text === inputLines[inputEndLine] &&
            document.lineAt(endLine - 1).text === inputLines[inputEndLine - 1] &&
            document.lineAt(endLine - 2).text === inputLines[inputEndLine - 2]) {
            endMatch = true
            break
        }
        endLine--
        inputEndLine--
    }

    if (startMatch && endMatch) {
        const start = new vscode.Position(startLine, 0)
        const end = new vscode.Position(endLine + 1, 0)
        return new vscode.Range(start, end)
    }
    return
}
