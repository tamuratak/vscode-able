

export function scanDisplayMath(text: string, index: number): number {
    if (index < 0 || index >= text.length) {
        return 0
    }
    if (text[index] !== '$' || text[index + 1] !== '$') {
        return 0
    }
    let i = index + 2
    while (true) {
        if (text[i] === '$' && text[i + 1] === '$') {
            return i + 1
        } else if (i >= text.length) {
            return 0
        } else if (text[i] === '\\') {
            i += 2
        } else {
            i += 1
        }
    }
}

export function scanInlineMath(text: string, index: number): number {
    if (index < 0 || index >= text.length) {
        return 0
    }
    if (text[index] !== '$') {
        return 0
    }
    let i = index + 1
    while (true) {
        if (text[i] === '$') {
            return i
        } else if (i >= text.length) {
            return 0
        } else if (text[i] === '\\') {
            i += 2
        } else {
            i += 1
        }
    }
}

export function scanCodeBlock(text: string, index: number): number {
    if (index < 0 || index >= text.length) {
        return 0
    }
    if (index === 0 || text[index - 1] !== '\n') {
        return 0
    }
    const backticks = /(```+|~~~+)/y
    backticks.lastIndex = index
    const match = backticks.exec(text)
    if (!match) {
        return 0
    }
    const tickSequence = match[1]
    const endIndex = text.indexOf('\n' + tickSequence, backticks.lastIndex)
    if (endIndex === -1) {
        return 0
    }
    return endIndex + 1 + tickSequence.length
}

