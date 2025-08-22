import * as vscode from 'vscode'

export interface ExtractedToken {
    uri: vscode.Uri
    line: number
    character: number
    length: number
    tokenType: string
    modifiers: string[]
    varname: string
}

/**
 * Extract tokens whose tokenType is 'variable' and which have the
 * 'declaration' tokenModifier set from semantic tokens for the given range.
 */
export async function extractVariableDeclarationTokens(document: vscode.TextDocument, range: vscode.Range, token?: vscode.CancellationToken): Promise<ExtractedToken[]> {
    if (token?.isCancellationRequested) {
        throw new vscode.CancellationError()
    }

    // get legend (tokenTypes and tokenModifiers)
    const legend = await vscode.commands.executeCommand<vscode.SemanticTokensLegend | undefined>('vscode.provideDocumentRangeSemanticTokensLegend', document.uri, range)
    if (!legend || !Array.isArray(legend.tokenTypes)) {
        // if legend is missing, we cannot reliably map indices -> names
        return []
    }

    if (token?.isCancellationRequested) {
        throw new vscode.CancellationError()
    }

    // get semantic tokens for the range
    const sem = await vscode.commands.executeCommand<vscode.SemanticTokens | undefined>('vscode.provideDocumentRangeSemanticTokens', document.uri, range)
    if (!sem || !sem.data) {
        return []
    }

    const data = Array.from(sem.data)
    const tokenTypes = legend.tokenTypes
    const tokenModifiersLegend = Array.isArray(legend.tokenModifiers) ? legend.tokenModifiers : []

    const results: ExtractedToken[] = []

    // decode stream: 5 integers per token
    let i = 0
    let prevLine = 0
    let prevStart = 0
    while (i + 4 < data.length) {
        if (token?.isCancellationRequested) {
            throw new Error('Cancelled')
        }
        const deltaLine = data[i++]
        const deltaStart = data[i++]
        const length = data[i++]
        const tokenTypeIndex = data[i++]
        const tokenModifierBits = data[i++]

        const curLine = prevLine + deltaLine
        let curStart: number
        if (deltaLine === 0) {
            curStart = prevStart + deltaStart
        } else {
            curStart = deltaStart
        }

        // map to document absolute coordinates
        const absoluteLine = curLine
        const absoluteCharacter = curStart

        prevLine = curLine
        prevStart = curStart

        const tokenType = tokenTypes[tokenTypeIndex] ?? String(tokenTypeIndex)

        // expand modifier bits
        const modifiers: string[] = []
        for (let b = 0; b < tokenModifiersLegend.length; b++) {
            if ((tokenModifierBits & (1 << b)) !== 0) {
                modifiers.push(tokenModifiersLegend[b])
            }
        }

        // filter: require tokenType === 'variable' and modifiers includes 'declaration'
        if (tokenType === 'variable' && modifiers.includes('declaration')) {
            // read token text from document
            let varname = ''
            try {
                const startPos = new vscode.Position(absoluteLine, absoluteCharacter)
                const endPos = new vscode.Position(absoluteLine, absoluteCharacter + length)
                varname = document.getText(new vscode.Range(startPos, endPos))
            } catch {
                varname = ''
            }
            results.push({
                uri: document.uri,
                line: absoluteLine,
                character: absoluteCharacter,
                length,
                tokenType,
                modifiers,
                varname
            })
        }
    }

    return results
}

/**
 * Given a document URI and a code snippet string, find the first matching range
 * inside the document, call `extractDeclarationTokens` on that range and return
 * both the extracted tokens and a deduplicated list of variable names.
 */
export async function extractDeclarationsFromUriCode(uri: vscode.Uri, code: string, token?: vscode.CancellationToken) {
    const document = await vscode.workspace.openTextDocument(uri)
    const full = document.getText()
    const idx = full.indexOf(code)
    if (idx === -1) {
        return { tokens: [] as ExtractedToken[], names: [] as string[] }
    }

    const startPos = document.positionAt(idx)
    const endPos = document.positionAt(idx + code.length)
    const range = new vscode.Range(startPos, endPos)

    const tokens = await extractVariableDeclarationTokens(document, range, token)
    return tokens
}
