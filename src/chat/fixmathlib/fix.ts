

export function doFixMath(text: string) {
    const fixedLines: string[] = []
    for (const line of text.split('\n')) {
        if (/^\s*\$\$\s*$/.exec(line)) {
            // $$ only line is ok.
            fixedLines.push(line)
        } else if (/^\s*\\[[\]]\s*$/.exec(line)) {
            // Replace \[ and \] only line with $$.
            fixedLines.push(line.replace(/^(\s*)\\[[\]](\s*)$/, '$1$$$$$2'))
        } else {
            // Replace $$, \(, and \) with $.
            fixedLines.push(line.replace(/\\[()]/g, '$$').replace(/\$\$/g, '$$'))
        }
    }
    return fixedLines.join('\n')
}


export function scanHtml(text: string, index: number) {
    if (index < 0) { index = 0 }
    if (index >= text.length) { return '' }
    if (text[index] !== '<') {
        let i = index
        while (i < text.length && text[i] !== '<') {
            i++
        }
        return text.slice(index, i)
    }
    const end = scanHtmlTag(text, index)
    return text.slice(index, end)
}

function scanHtmlTag(text: string, index: number): number {
    const length = text.length
    if (index < 0) { index = 0 }
    if (index >= length || text[index] !== '<') { return index }

    // HTML comment
    if (text.startsWith('<!--', index)) {
        const pos = text.indexOf('-->', index + 4)
        return pos === -1 ? length : pos + 3
    }

    // CDATA
    if (text.startsWith('<![CDATA[', index)) {
        const pos = text.indexOf(']]>', index + 9)
        return pos === -1 ? length : pos + 3
    }

    // Processing instruction
    if (text.startsWith('<?', index)) {
        const pos = text.indexOf('?>', index + 2)
        return pos === -1 ? length : pos + 2
    }

    // Normal tag: skip until unquoted '>' is found
    let i = index + 1
    let inSingleQuote = false
    let inDoubleQuote = false
    while (i < length) {
        const ch = text[i]
        if (ch === '"' && !inSingleQuote) {
            inDoubleQuote = !inDoubleQuote
        } else if (ch === '\'' && !inDoubleQuote) {
            inSingleQuote = !inSingleQuote
        } else if (ch === '>' && !inSingleQuote && !inDoubleQuote) {
            return i + 1
        }
        i++
    }
    return length
}
