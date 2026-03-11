/**
 * Extracts the matching closing tag for a given HTML tag.
 * @param text The HTML text to search.
 * @param index The index of the opening tag.
 * @returns The index of the end of the matching closing tag, or 0 if not found or if the index is not at an opening tag.
 */
export function extractMatchingHtmlTag(text: string, index: number) {
    const length = text.length
    if (index < 0 || index >= length || text[index] !== '<') {
        return 0
    }
    const startPos = scanHtmlTag(text, index)
    if (startPos <= index) {
        return 0
    }
    const tagText = text.slice(index, startPos)
    if (tagText.startsWith('<!--') || tagText.startsWith('<![CDATA[') || tagText.startsWith('<?') || tagText[1] === '!') {
        return startPos
    }
    if (tagText.startsWith('</')) {
        return 0
    }
    const openingMatch = /^<([a-zA-Z][\w:-]*)/.exec(tagText)
    if (!openingMatch) {
        return 0
    }
    const tagName = openingMatch[1].toLowerCase()
    const selfClosingTag = /\/\s*>$/.test(tagText)
    const voidHtmlTags = new Set([
        'area', 'base', 'br', 'col', 'command', 'embed', 'hr', 'img', 'input', 'keygen', 'link',
        'meta', 'param', 'source', 'track', 'wbr'
    ])
    if (selfClosingTag || voidHtmlTags.has(tagName)) {
        return startPos
    }
    let depth = 1
    let cursor = startPos
    while (cursor < length) {
        const nextStart = text.indexOf('<', cursor)
        if (nextStart === -1) {
            break
        }
        const nextEnd = scanHtmlTag(text, nextStart)
        if (nextEnd <= nextStart) {
            cursor = nextStart + 1
            continue
        }
        const nextTagText = text.slice(nextStart, nextEnd)
        if (nextTagText.startsWith('</')) {
            const closingMatch = /^<\/\s*([a-zA-Z][\w:-]*)/.exec(nextTagText)
            if (closingMatch) {
                const closingName = closingMatch[1].toLowerCase()
                if (closingName === tagName) {
                    depth--
                    if (depth === 0) {
                        return nextEnd
                    }
                }
            }
            cursor = nextEnd
            continue
        }
        const nestedMatch = /^<\s*([a-zA-Z][\w:-]*)/.exec(nextTagText)
        if (nestedMatch) {
            const nestedName = nestedMatch[1].toLowerCase()
            if (nestedName === tagName) {
                const nestedSelfClosing = /\/\s*>$/.test(nextTagText)
                if (!nestedSelfClosing && !voidHtmlTags.has(nestedName)) {
                    depth++
                }
            }
        }
        cursor = nextEnd
    }
    return 0
}

export function scanHtmlTag(text: string, index: number): number {
    const length = text.length
    if (index < 0) { index = 0 }
    if (index >= length || text[index] !== '<') { return 0 }

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
    const pos = scanHtmlTagImpl(text, index)
    if (pos && pos > index) {
        return pos
    }
    return 0
}

export function scanHtmlTagImpl(text: string, index: number): number {
    const length = text.length
    if (index >= length) {
        return 0
    }
    if (text[index] !== '<') {
        return 0
    }
    const oneCharTag = /<\w\b/y
    oneCharTag.lastIndex = index
    const aTag = /<[abipsqu]\b/iy
    aTag.lastIndex = index
    if (oneCharTag.test(text) && !aTag.test(text)) {
        return 0
    }
    const htmlOpeningTagRegex = /<[\w:-]+\s*\/?>/y
    const htmlClosingTagRegex = /<\/[\w:-]+>/y
    const htmlOpeningTagRegexWithAttr = /(<[\w:-]+\s+([\w:-]+\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*|[\w:-]+\s*)*?\/?>)/iy

    htmlOpeningTagRegex.lastIndex = index
    htmlClosingTagRegex.lastIndex = index
    htmlOpeningTagRegexWithAttr.lastIndex = index
    if (htmlOpeningTagRegex.test(text)) {
        return htmlOpeningTagRegex.lastIndex
    }
    if (htmlClosingTagRegex.test(text)) {
        return htmlClosingTagRegex.lastIndex
    }
    if (htmlOpeningTagRegexWithAttr.test(text)) {
        return htmlOpeningTagRegexWithAttr.lastIndex
    }
    return 0
}
