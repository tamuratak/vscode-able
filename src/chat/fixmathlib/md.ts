import { scanHtmlTag } from './html.js'


interface MarkdownElement {
    kind: 'htmlTag' | 'displayMath' | 'inlineMath' | 'codeBlock' | 'text' | 'lineBreak'
    pos: number
    content: string
}

export function scanMarkdown(text: string, index = 0): MarkdownElement[] {
    const result: MarkdownElement[] = []
    const specialCharacterRegex = /[<$`~\n]/y
    let prev = index
    let pos = index
    while (true) {
        if (pos >= text.length) {
            if (prev < text.length) {
                result.push({
                    kind: 'text',
                    pos: prev,
                    content: text.slice(prev)
                })
            }
            break
        }
        specialCharacterRegex.lastIndex = pos
        if (specialCharacterRegex.test(text)) {
            const ret = scanMarkdownImpl(text, pos)
            if (ret) {
                if (prev === pos) {
                    result.push(ret)
                } else {
                    const textElement: MarkdownElement = {
                        kind: 'text',
                        pos: prev,
                        content: text.slice(prev, pos)
                    }
                    result.push(textElement, ret)
                }
                prev = ret.pos + ret.content.length
                pos = ret.pos + ret.content.length
                continue
            }
        }
        pos += 1
    }
    return result
}

export function scanMarkdownImpl(text: string, index: number): MarkdownElement | undefined {
    if (index < 0 || index >= text.length) {
        return
    }
    let endPos = scanHtmlTag(text, index)
    if (endPos) {
        return {
            kind: 'htmlTag',
            pos: index,
            content: text.slice(index, endPos)
        }
    }
    endPos = scanDisplayMath(text, index)
    if (endPos) {
        return {
            kind: 'displayMath',
            pos: index,
            content: text.slice(index, endPos)
        }
    }
    endPos = scanInlineMath(text, index)
    if (endPos) {
        return {
            kind: 'inlineMath',
            pos: index,
            content: text.slice(index, endPos)
        }
    }
    endPos = scanCodeBlock(text, index)
    if (endPos) {
        return {
            kind: 'codeBlock',
            pos: index,
            content: text.slice(index, endPos)
        }
    }
    const lineBreakRegex = /\n+/y
    lineBreakRegex.lastIndex = index
    const match = lineBreakRegex.exec(text)
    if (match) {
        return {
            kind: 'lineBreak',
            pos: index,
            content: match[0]
        }
    }
    return
}

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
            return i + 2
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
    // Avoid treating '$$' as inline math start.
    if (text[index + 1] === '$') {
        return 0
    }
    let i = index + 1
    while (true) {
        // Inline math should not span lines.
        if (text[i] === '\n') {
            return 0
        }
        if (text[i] === '$') {
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

export function scanCodeBlock(text: string, index: number): number {
    if (index < 0 || index >= text.length) {
        return 0
    }
    if (index > 0 && text[index - 1] !== '\n') {
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

