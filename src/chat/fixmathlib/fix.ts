

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


export function scanHtmlTag(text: string, index: number) {
    const textRegex = /[^<]+/y
    textRegex.lastIndex = index
    const match = textRegex.exec(text)
    if (match) {
        return { kind: 'text', value: match[0] }
    }

    const htmlTagRegex = /<[a-z1-6]+(?:\s+(?:[^"'>\s]+(?:=(?:"[^"]*"|'[^']*'|[^"'>\s]+))?))*\s*\/?>/yi
    htmlTagRegex.lastIndex = index
    const htmlTagMatch = htmlTagRegex.exec(text)
    if (htmlTagMatch) {
        return { kind: 'htmlTag', value: htmlTagMatch[0] }
    }
    return
}

export function scanHtml(text: string, index: number) {

}
