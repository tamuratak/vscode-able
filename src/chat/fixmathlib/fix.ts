import { scanHtmlTag, extractMatchingHtmlTag } from './html.js'
import { convertTableToMarkdown } from './table.js'


export function doFixMath(text: string) {
    if (/<span/.exec(text)) {
        const result = transformHtmlToMarkdown(text)
        return result.join('')
    } else {
        const fixedLines: string[] = []
        for (const line of text.split('\n')) {
            if (/^\s*\$\$\s*$/.exec(line)) {
                // $$ only line is ok.
                fixedLines.push(line)
            } else if (/^\s*\$\$((?!\$\$).)*?\$\$\s*$/.exec(line)) {
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

export function unescapeHtml(text: string) {
    return text.replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>')
}

export function transformHtmlToMarkdown(text: string) {
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
                    const mathEnd = extractMatchingHtmlTag(text, index)
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
                    const mathEnd = extractMatchingHtmlTag(text, index)
                    if (mathEnd > pos) {
                        result.push('\n$$\n', unescapeHtml(mathText), '\n$$\n')
                        index = mathEnd
                    } else {
                        index = pos
                    }
                    continue
                }

                if (/<table[ >]/i.test(tagText)) {
                    const tableEnd = extractMatchingHtmlTag(text, index)
                    if (tableEnd > pos) {
                        let tableHtml = text.slice(index + tagText.length, tableEnd)
                        tableHtml = transformHtmlToMarkdown(tableHtml).join('')
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
                    index = pos
                    continue
                }

                const linkMatch = /<a\s+[^>]*href="([^"]*?)"/i.exec(tagText)
                if (linkMatch) {
                    const href = linkMatch[1]
                    const linkEnd = extractMatchingHtmlTag(text, index)
                    if (linkEnd > pos) {
                        const linkText = transformHtmlToMarkdown(text.slice(pos, linkEnd - ('</a>'.length))).join('')
                        result.push(linkText, ' (', href, ') ')
                        index = linkEnd
                    } else {
                        index = pos
                    }
                    continue
                }

                if (/^<(thinking-panel|deep-research-source-lists)/i.test(tagText)) {
                    const panelEnd = extractMatchingHtmlTag(text, index)
                    if (panelEnd > pos) {
                        index = panelEnd
                    } else {
                        index = pos
                    }
                    continue
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
