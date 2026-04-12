import * as vscode from 'vscode'
import { MathJaxPool } from './mathjaxpool.js'
import { debugObj } from '../utils/debug.js'
import { svgToDataUrl } from '../utils/svg.js'


export class MathRenderer implements vscode.HoverProvider, vscode.Disposable {
    private readonly mathJaxPool = new MathJaxPool()

    constructor(private readonly extension: {
        outputChannel: vscode.LogOutputChannel
    }) { }

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Hover | undefined> {
        const isOnDoubleDollar = document.getWordRangeAtPosition(position, /\$\$/)
        if (!isOnDoubleDollar) {
            return
        }
        let mathRange: vscode.Range | undefined
        for (let lineNum = position.line + 1; lineNum < position.line + 10 && lineNum < document.lineCount; lineNum++) {
            const line = document.lineAt(lineNum).text
            if (/\s*\$\$\s*/.test(line)) {
                mathRange = new vscode.Range(position.line, 0, lineNum, line.length)
                break
            }
        }
        if (!mathRange) {
            return
        }
        const mathText = document.getText(mathRange).trim().replace(/^\$\$/, '').replace(/\$\$$/, '')
        try {
            const xml = await this.mathJaxPool.typeset(mathText, { scale: 0.9, color: 'black' })
            const dataUrl = svgToDataUrl(xml)
            return new vscode.Hover(new vscode.MarkdownString(this.addDummyCodeBlock(`![equation](${dataUrl})`)), mathRange)
        } catch (e) {
            debugObj('MathJax typesetting error:', e, this.extension.outputChannel)
            return
        }
    }

    private addDummyCodeBlock(md: string): string {
        // We need a dummy code block in hover to make the width of hover larger.
        const dummyCodeBlock = '```\n```'
        return dummyCodeBlock + '\n' + md + '\n' + dummyCodeBlock
    }

    dispose() {
        return this.mathJaxPool.dispose()
    }

}
