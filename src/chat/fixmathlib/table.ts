import { unescapeHtml } from './fix.js'
import { scanHtmlTag } from './html.js'


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
