

export function scanHtmlTag2(text: string, index: number): number {
    const length = text.length
    if (index >= length) {
        return 0
    }
    if (text[index] !== '<') {
        return 0
    }
    const oneCharTag = /<\w\b/y
    oneCharTag.lastIndex = index
    const aTag = /<[abipsqu]\b/y
    aTag.lastIndex = index
    if (oneCharTag.test(text) && !aTag.test(text)) {
        return 0
    }
    const htmlOpeningTagRegex = /<\w+\s*\/?>/y
    const htmlClosingTagRegex = /<\/\w+>/y
    const htmlOpeningTagRegexWithAttr = /(<\w+\s+([-_a-z0-9]+\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*|[-_a-z0-9]+\s*)*?\/?>)/iy

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
