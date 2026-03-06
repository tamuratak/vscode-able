export function doFixMath(text: string) {
    const fixedLines: string[] = []
    for (const line of text.split('\n')) {
        if (/^\s*\$\$\s*$/.exec(line)) {
            fixedLines.push(line)
        } else if (/^\s*\\[[\]]\s*$/.exec(line)) {
            fixedLines.push(line.replace(/^(\s*)\\[[\]](\s*)$/, '$1$$$$$2'))
        } else {
            fixedLines.push(line.replace(/\\[()]/g, '$$').replace(/\$\$/g, '$$'))
        }
    }
    return fixedLines.join('\n')
}
