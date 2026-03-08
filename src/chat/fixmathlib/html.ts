
export function scanMatchingHtmlTag(text: string, index: number) {
    if (index < 0) { index = 0 }
    if (index >= text.length || text[index] !== '<') { return index }

    // Simple tags that do not have matching end tags in HTML
    const voidTags = new Set([
        'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'keygen', 'link', 'meta', 'param', 'source', 'track', 'wbr'
    ])

    const startTagEnd = scanHtmlTag(text, index)
    const startTag = text.slice(index, startTagEnd)

    // comments, cdata, processing instructions are standalone
    if (startTag.startsWith('<!--') || startTag.startsWith('<![CDATA[') || startTag.startsWith('<?')) {
        return startTagEnd
    }

    // extract tag name
    const m = /^<\s*([A-Za-z0-9:_-]+)/.exec(startTag)
    if (!m) { return startTagEnd }
    const tagName = m[1].toLowerCase()

    // self-closing start tag like <img />
    if (/\/\s*>$/.test(startTag) || voidTags.has(tagName)) {
        return startTagEnd
    }

    // find matching closing tag, accounting for nested same tags
    let depth = 1
    let pos = startTagEnd
    const length = text.length
    while (pos < length) {
        const next = text.indexOf('<', pos)
        if (next === -1) {
            return length
        }

        // Skip comments/CDATA/PI
        if (text.startsWith('<!--', next) || text.startsWith('<![CDATA[', next) || text.startsWith('<?', next)) {
            pos = scanHtmlTag(text, next)
            continue
        }

        const after = text[next + 1]
        if (after === '/') {
            // closing tag
            const cmRe = /<\/\s*([A-Za-z0-9:_-]+)/y
            cmRe.lastIndex = next
            const cm = cmRe.exec(text)
            if (cm) {
                const name = cm[1].toLowerCase()
                const endPos = scanHtmlTag(text, next)
                if (name === tagName) {
                    depth--
                    if (depth === 0) {
                        return endPos
                    }
                }
                pos = endPos
                continue
            } else {
                pos = next + 2
                continue
            }
        } else {
            // opening tag
            const omRe = /<\s*([A-Za-z0-9:_-]+)/y
            omRe.lastIndex = next
            const om = omRe.exec(text)
            if (om) {
                const name = om[1].toLowerCase()
                const endPos = scanHtmlTag(text, next)
                const tagText = text.slice(next, endPos)
                const selfClose = /\/\s*>$/.test(tagText) || voidTags.has(name)
                if (!selfClose && name === tagName) {
                    depth++
                }
                pos = endPos
                continue
            } else {
                pos = next + 1
                continue
            }
        }
    }

    return length
}

export function scanHtmlTag(text: string, index: number): number {
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
