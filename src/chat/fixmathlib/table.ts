import { unescapeHtml } from './fix.js'
import { extractMatchingHtmlTag, scanHtmlTag } from './html.js'


interface TableRow {
    cells: string[],
    isHeader: boolean
}

const anchorClosingTagLength = 4

function normalizeCellValue(raw: string) {
    const collapsed = unescapeHtml(raw).replace(/\s+/g, ' ').trim()
    return collapsed.replace(/\|/g, '\\|')
}

function extractTextFromCell(html: string) {
    const parts: string[] = []
    let cursor = 0
    while (cursor < html.length) {
        if (html[cursor] === '<') {
            const tagEnd = scanHtmlTag(html, cursor)
            if (tagEnd <= cursor) {
                cursor++
                continue
            }
            const tagText = html.slice(cursor, tagEnd)
            if (tagText.startsWith('</')) {
                cursor = tagEnd
                continue
            }
            const nameMatch = /^<\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(tagText)
            if (nameMatch) {
                const tagName = nameMatch[1].toLowerCase()
                if (tagName === 'a') {
                    const hrefMatch = /href\s*=\s*(?:"([^"]*?)"|'([^']*?)')/i.exec(tagText)
                    const href = hrefMatch?.[1] ?? hrefMatch?.[2]
                    const anchorEnd = extractMatchingHtmlTag(html, cursor)
                    if (anchorEnd > tagEnd) {
                        const innerHtml = html.slice(tagEnd, anchorEnd - anchorClosingTagLength)
                        const linkText = extractTextFromCell(innerHtml)
                        if (href) {
                            parts.push('[', linkText, '](', href, ')')
                        } else {
                            parts.push(linkText)
                        }
                        cursor = anchorEnd
                        continue
                    }
                }
            }
            cursor = tagEnd
            continue
        }
        const nextTag = html.indexOf('<', cursor)
        const segmentEnd = nextTag === -1 ? html.length : nextTag
        parts.push(html.slice(cursor, segmentEnd))
        cursor = segmentEnd
    }
    return parts.join('')
}

function parseTableRows(tableHtml: string) {
    const rows: TableRow[] = []
    let index = 0
    let inThead = false
    let currentRow: TableRow | null = null
    while (index < tableHtml.length) {
        const openTag = tableHtml.indexOf('<', index)
        if (openTag === -1) {
            break
        }
        const tagEnd = scanHtmlTag(tableHtml, openTag)
        if (tagEnd <= openTag) {
            index = openTag + 1
            continue
        }
        const tagText = tableHtml.slice(openTag, tagEnd)
        index = tagEnd
        const match = /^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:-]*)/.exec(tagText)
        if (!match) {
            continue
        }
        const isClosing = match[1] === '/'
        const tagName = match[2].toLowerCase()
        if (tagName === 'thead') {
            inThead = !isClosing
            continue
        }
        if (tagName === 'tr') {
            if (isClosing) {
                currentRow = null
            } else {
                currentRow = { cells: [], isHeader: inThead }
                rows.push(currentRow)
            }
            continue
        }
        if ((tagName === 'td' || tagName === 'th') && !isClosing && currentRow) {
            const cellEnd = extractMatchingHtmlTag(tableHtml, openTag)
            const closingTag = '</' + tagName + '>'
            const safeInnerEnd = cellEnd > tagEnd ? Math.max(tagEnd, cellEnd - closingTag.length) : tagEnd
            const cellHtml = tableHtml.slice(tagEnd, safeInnerEnd)
            currentRow.cells.push(normalizeCellValue(extractTextFromCell(cellHtml)))
            if (tagName === 'th') {
                currentRow.isHeader = true
            }
            index = cellEnd > tagEnd ? cellEnd : tagEnd
            continue
        }
    }
    return rows
}

function buildRowLine(cells: string[]) {
    return '| ' + cells.join(' | ') + ' |'
}

/**
 * Converts HTML table to Markdown format. Handles <thead> for header rows, but if not present uses first row as header. Extracts text content from cells, converting links to markdown format. Pads rows with fewer cells to match column count. Normalizes whitespace and escapes pipe characters in cell content.
 * @param tableHtml HTML string containing a single <table> element.
 * @returns
 */
export function convertTableToMarkdown(tableHtml: string): string {

    const rows = parseTableRows(tableHtml)
    const populatedRows = rows.filter(row => row.cells.length > 0)
    if (populatedRows.length === 0) {
        return ''
    }
    const columnCount = populatedRows.reduce((max, row) => Math.max(max, row.cells.length), 0)
    if (columnCount === 0) {
        return ''
    }
    for (const row of populatedRows) {
        while (row.cells.length < columnCount) {
            row.cells.push('')
        }
    }
    let headerIndex = populatedRows.findIndex(row => row.isHeader)
    if (headerIndex === -1) {
        headerIndex = 0
    }
    const headerRow = populatedRows[headerIndex]
    const bodyRows = populatedRows.filter((_, index) => index !== headerIndex)
    const headerLine = buildRowLine(headerRow.cells)
    const separatorLine = buildRowLine(headerRow.cells.map(() => '---'))
    const lines = [headerLine, separatorLine]
    for (const row of bodyRows) {
        lines.push(buildRowLine(row.cells))
    }
    return lines.join('\n')
}
