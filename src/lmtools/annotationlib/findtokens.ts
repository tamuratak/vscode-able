import * as vscode from 'vscode'

export interface ExtractedToken {
    uri: vscode.Uri
    line: number
    character: number
    length: number
    tokenType: string
    modifiers: string[]
    text: string
}

/**
 * Extract tokens whose tokenType is 'declaration' and which have the
 * 'declaration' tokenModifier set from semantic tokens for the given range.
 *
 * Algorithm:
 *  - call the VS Code commands to get the legend and semantic tokens for the range
 *  - decode the uint32 token stream according to the semantic token spec
 *  - map tokenType index -> name using legend.tokenTypes
 *  - expand modifier bits using legend.tokenModifiers
 *  - filter tokens where tokenType === 'declaration' && modifiers includes 'declaration'
 *  - read the token text from the document and return an array of ExtractedToken
 */
export async function extractDeclarationTokens(document: vscode.TextDocument, range: vscode.Range, token?: vscode.CancellationToken): Promise<ExtractedToken[]> {
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
        const absoluteLine = range.start.line + curLine
        const absoluteCharacter = (curLine === 0) ? range.start.character + curStart : curStart

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
            let text = ''
            try {
                const startPos = new vscode.Position(absoluteLine, absoluteCharacter)
                const endPos = new vscode.Position(absoluteLine, absoluteCharacter + length)
                text = document.getText(new vscode.Range(startPos, endPos))
            } catch {
                text = ''
            }
            results.push({
                uri: document.uri,
                line: absoluteLine,
                character: absoluteCharacter,
                length,
                tokenType,
                modifiers,
                text
            })
        }
    }

    return results
}
