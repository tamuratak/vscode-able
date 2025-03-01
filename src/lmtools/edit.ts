import { LanguageModelTextPart, LanguageModelTool, LanguageModelToolInvocationOptions, LanguageModelToolResult } from 'vscode'
import * as vscode from 'vscode'
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

/**
 * @param array1 The array of strings
 * @param array2 The target array of strings
 * @returns The edit distance of array1 and array2
 */
export function calculateEditDistance(array1: string[], array2: string[]): number {
    const m = array1.length
    const n = array2.length

    // Create a 2D array to store the minimum operations
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0))

    // Fill the dp array
    for (let i = 0; i <= m; i++) {
        for (let j = 0; j <= n; j++) {
            if (i === 0) {
                dp[i][j] = j // If array1 is empty, insert all elements of array2
            } else if (j === 0) {
                dp[i][j] = i // If array2 is empty, delete all elements of array1
            } else {
                const cost = array1[i - 1] === array2[j - 1] ? 0 : 1 // If elements are the same, no cost
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1, // Deletion
                    dp[i][j - 1] + 1, // Insertion
                    dp[i - 1][j - 1] + cost // Substitution
                )
            }
        }
    }
    return dp[m][n]
}
