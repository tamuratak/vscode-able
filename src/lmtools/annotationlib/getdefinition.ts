import * as vscode from 'vscode'

export interface DefinitionTextResult {
    startLine: number
    endLine: number
    text: string
}

export async function getDefinitionTextFromUriAtPosition(
    defUri: vscode.Uri,
    pos: vscode.Position
): Promise<DefinitionTextResult> {
    // attempt to get document symbols for the target document
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
            const text = doc.getText(new vscode.Range(new vscode.Position(startLine, 0), new vscode.Position(endLine + 1, 0)))
            return { startLine, endLine, text }
        }
    }
    throw new Error(`No suitable symbol found for position ${JSON.stringify(pos)} in document ${defUri.fsPath}`)
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
