export function wrapLongLines(input: string): string {
    const lines = input.split('\n')
    const maxLineLength = 90
    const wrappedLines = lines.map(line => {
        if (line.length <= maxLineLength) {
            return line
        } else {
            const chunks: string[] = []
            for (let i = 0; i < line.length; i += maxLineLength) {
                chunks.push(line.slice(i, i + maxLineLength))
            }
            return chunks.join('\\\n')
        }
    })
    return wrappedLines.join('\n')
}
