import * as vscode from 'vscode'


export async function getDefinitionTextFromUriAtPosition(defUri: vscode.Uri, pos: vscode.Position, outputChannel: vscode.LogOutputChannel) {
    // attempt to get document symbols for the target document
    try {
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', defUri)
        if (symbols && symbols.length > 0) {
            // find smallest enclosing symbol
            let best: vscode.DocumentSymbol | undefined
            let bestRangeSize = Number.MAX_SAFE_INTEGER
            const visit = (sym: vscode.DocumentSymbol) => {
                const r = sym.range
                if (positionInRange(pos, r)) {
                    const size = (r.end.line - r.start.line) * 1000 + (r.end.character - r.start.character)
                    if (size < bestRangeSize) {
                        best = sym
                        bestRangeSize = size
                    }
                }
                if (sym.children) {
                    for (const c of sym.children) {
                        visit(c)
                    }
                }
            }
            for (const s of symbols) {
                visit(s)
            }
            if (best) {
                // open document and extract text for best.range
                const doc = await vscode.workspace.openTextDocument(defUri)
                const startLine = best.range.start.line
                const endLine = best.range.end.line
                let text = doc.getText(new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(endLine + 1, 0)))
                // trim if too large
                const maxLines = 40
                const lines = text.split(/\r?\n/)
                let truncated = false
                if (lines.length > maxLines) {
                    text = lines.slice(0, maxLines).join('\n') + '\n// ...(truncated)'
                    truncated = true
                }
                return { startLine, endLine, text, method: 'documentSymbol', truncated }
            }
        }
    } catch (e) {
        outputChannel.debug(`[AnnotationTool]: executeDocumentSymbolProvider failed - ${String(e)}`)
    }

    // fallback: open document and return a small snippet around pos
    try {
        const doc = await vscode.workspace.openTextDocument(defUri)
        const startLine = Math.max(0, pos.line - 2)
        const endLine = Math.min(doc.lineCount - 1, pos.line + 20)
        const text = doc.getText(new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(endLine + 1, 0)))
        return { startLine, endLine, text, method: 'fallback-range' }
    } catch (e) {
        outputChannel.debug(`[AnnotationTool]: openTextDocument failed for ${defUri.fsPath} - ${String(e)}`)
        throw e
    }
}

function positionInRange(pos: vscode.Position, range: vscode.Range) {
    if (pos.line < range.start.line || pos.line > range.end.line) {
        return false
    }
    if (pos.line === range.start.line && pos.character < range.start.character) {
        return false
    }
    if (pos.line === range.end.line && pos.character > range.end.character) {
        return false
    }
    return true
}
