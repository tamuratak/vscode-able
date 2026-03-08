

export function doFixMath(text: string) {
    if (/<span/.exec(text)) {
        const result = scanHtml(text)
        return result.join('')
    } else {
        const fixedLines: string[] = []
        for (const line of text.split('\n')) {
            if (/^\s*\$\$\s*$/.exec(line)) {
                // $$ only line is ok.
                fixedLines.push(line)
            } else if (/^\s*\\\$\$((?!\$\$).)*?\$\$\s*$/.exec(line)) {
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
}

function unescapeHtml(text: string) {
    return text.replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>')
}

export function scanHtml(text: string) {
    const result: string[] = []
    let index = 0
    const length = text.length
    while (index < length) {
        if (text[index] === '<') {
            // at a tag, skip over it
            const pos = scanHtmlTag(text, index)
            if (pos <= index) {
                // safety: advance to avoid infinite loop
                index++
            } else {
                const tagText = text.slice(index, pos);
                const inlineMathMatch = /^<span class="math-inline" data-math="([^"]*?)"/.exec(tagText)
                if (inlineMathMatch) {
                    const mathText = inlineMathMatch[1]
                    const mathEnd = scanMatchingHtmlTag(text, index)
                    if (mathEnd > pos) {
                        result.push('$', unescapeHtml(mathText), '$')
                        index = mathEnd
                    } else {
                        index = pos
                    }
                    continue
                }

                const blockMathMatch = /^<div class="math-block" data-math="([^"]*?)"/.exec(tagText)
                if (blockMathMatch) {
                    const mathText = blockMathMatch[1]
                    const mathEnd = scanMatchingHtmlTag(text, index)
                    if (mathEnd > pos) {
                        result.push('\n$$\n', unescapeHtml(mathText), '\n$$\n')
                        index = mathEnd
                    } else {
                        index = pos
                    }
                    continue
                }

                if (/<table /i.test(tagText)) {
                    const tableEnd = scanMatchingHtmlTag(text, index)
                    if (tableEnd > pos) {
                        let tableHtml = text.slice(index + tagText.length, tableEnd)
                        tableHtml = scanHtml(tableHtml).join('')
                        const markdown = convertTableToMarkdown('<table>' + tableHtml + '</table>')
                        if (markdown) {
                            result.push('\n\n', markdown, '\n\n')
                        }
                        index = tableEnd
                    } else {
                        index = pos
                    }
                    continue
                }
                if (/<\/?(tr|td|thead|tbody)>/.exec(tagText)) {
                    result.push(tagText)
                    index = pos
                    continue
                }

                const headingMatch = /<h([1-6])\b/i.exec(tagText)
                if (headingMatch) {
                    const level = headingMatch[1]
                    result.push('\n\n', '#'.repeat(parseInt(level)), ' ')
                    index = pos
                    continue
                }
                if (/<\/h[1-6]>/.test(tagText)) {
                    result.push('\n\n')
                }

                index = pos
            }
        } else {
            // collect text until next '<'
            const next = text.indexOf('<', index)
            const pos = next === -1 ? length : next
            result.push(text.slice(index, pos))
            index = pos
        }
    }
    return result
}

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


interface TableRow {
    cells: string[],
    isHeader: boolean
}

export function convertTableToMarkdown(tableHtml: string): string {
    const rows: TableRow[] = []
    const lowerHtml = tableHtml.toLowerCase()
    let currentSection: 'thead' | 'tbody' | 'none' = 'none'
    let currentRow: TableRow | null = null
    let index = 0
    const length = tableHtml.length
    while (index < length) {
        const nextTagIndex = lowerHtml.indexOf('<', index)
        if (nextTagIndex === -1) {
            break
        }
        const tagEnd = scanHtmlTag(tableHtml, nextTagIndex)
        if (tagEnd <= nextTagIndex) {
            index = nextTagIndex + 1
            continue
        }
        if (lowerHtml.startsWith('<thead', nextTagIndex)) {
            currentSection = 'thead'
            index = tagEnd
            continue
        }
        if (lowerHtml.startsWith('</thead', nextTagIndex)) {
            currentSection = 'none'
            index = tagEnd
            continue
        }
        if (lowerHtml.startsWith('<tbody', nextTagIndex)) {
            currentSection = 'tbody'
            index = tagEnd
            continue
        }
        if (lowerHtml.startsWith('</tbody', nextTagIndex)) {
            currentSection = 'none'
            index = tagEnd
            continue
        }
        if (lowerHtml.startsWith('<table', nextTagIndex)) {
            index = tagEnd
            continue
        }
        if (lowerHtml.startsWith('</table', nextTagIndex)) {
            index = tagEnd
            continue
        }
        if (lowerHtml.startsWith('<tr', nextTagIndex)) {
            currentRow = { cells: [], isHeader: currentSection === 'thead' }
            index = tagEnd
            continue
        }
        if (lowerHtml.startsWith('</tr', nextTagIndex)) {
            if (currentRow) {
                rows.push(currentRow)
                currentRow = null
            }
            index = tagEnd
            continue
        }
        if (lowerHtml.startsWith('<td', nextTagIndex) || lowerHtml.startsWith('<th', nextTagIndex)) {
            if (!currentRow) {
                currentRow = { cells: [], isHeader: currentSection === 'thead' }
            }
            const isHeaderCell = lowerHtml.startsWith('<th', nextTagIndex)
            if (isHeaderCell) {
                currentRow.isHeader = true
            }
            const cellContentStart = tagEnd
            const closingTag = isHeaderCell ? '</th' : '</td'
            const closingIndex = lowerHtml.indexOf(closingTag, cellContentStart)
            if (closingIndex === -1) {
                index = tagEnd
                continue
            }
            const closingEnd = scanHtmlTag(tableHtml, closingIndex)
            const cellHtml = tableHtml.slice(cellContentStart, closingIndex)
            currentRow.cells.push(convertTableCellHtmlToMarkdown(cellHtml))
            index = closingEnd
            continue
        }
        if (lowerHtml.startsWith('</td', nextTagIndex) || lowerHtml.startsWith('</th', nextTagIndex)) {
            index = tagEnd
            continue
        }
        index = tagEnd
    }
    if (currentRow) {
        rows.push(currentRow)
    }
    if (rows.length === 0) {
        return ''
    }
    let headerIndex = rows.findIndex((row) => row.isHeader)
    if (headerIndex === -1) {
        headerIndex = 0
    }
    const headerRow = rows[headerIndex]
    const bodyRows = rows.filter((_, idx) => idx !== headerIndex)
    let columnCount = headerRow.cells.length
    for (const row of bodyRows) {
        if (row.cells.length > columnCount) {
            columnCount = row.cells.length
        }
    }
    if (columnCount === 0) {
        return ''
    }
    const resultLines: string[] = []
    resultLines.push(formatMarkdownRow(headerRow.cells, columnCount))
    resultLines.push(formatDivider(columnCount))
    for (const row of bodyRows) {
        resultLines.push(formatMarkdownRow(row.cells, columnCount))
    }
    return resultLines.join('\n')
}

function formatMarkdownRow(cells: string[], columnCount: number) {
    const padded: string[] = []
    for (const cell of cells) {
        padded.push(escapeMarkdownCell(cell))
    }
    while (padded.length < columnCount) {
        padded.push('')
    }
    return '| ' + padded.join(' | ') + ' |'
}

function formatDivider(columnCount: number) {
    const separators: string[] = []
    for (let i = 0; i < columnCount; i++) {
        separators.push('---')
    }
    return '| ' + separators.join(' | ') + ' |'
}

function convertTableCellHtmlToMarkdown(cellHtml: string) {
    let result = ''
    let offset = 0
    const lowerCell = cellHtml.toLowerCase()
    while (offset < cellHtml.length) {
        const anchorIndex = lowerCell.indexOf('<a', offset)
        if (anchorIndex === -1) {
            result += cellHtml.slice(offset)
            break
        }
        result += cellHtml.slice(offset, anchorIndex)
        const tagEnd = scanHtmlTag(cellHtml, anchorIndex)
        if (tagEnd <= anchorIndex) {
            offset = anchorIndex + 2
            continue
        }
        const href = extractHrefFromAnchorTag(cellHtml.slice(anchorIndex, tagEnd))
        const closeIndex = lowerCell.indexOf('</a', tagEnd)
        if (closeIndex === -1) {
            result += cellHtml.slice(anchorIndex, tagEnd)
            offset = tagEnd
            continue
        }
        const closeEnd = scanHtmlTag(cellHtml, closeIndex)
        const innerText = convertTableCellHtmlToMarkdown(cellHtml.slice(tagEnd, closeIndex))
        if (href) {
            result += '[' + innerText + '](' + href + ')'
        } else {
            result += innerText
        }
        offset = closeEnd
    }
    return normalizeTableCellText(result)
}

function escapeMarkdownCell(value: string) {
    return value.replace(/\|/g, '\\|')
}

function normalizeTableCellText(value: string) {
    return unescapeHtml(value)
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function extractHrefFromAnchorTag(tag: string) {
    const match = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(tag)
    return match ? match[1] ?? match[2] ?? match[3] ?? '' : ''
}
