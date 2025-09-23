// English proper noun extractor utilities
// Comments in English. Main interface: extractProperNouns(text) -> string[]

export function extractProperNouns(text: string): string[] {
    if (typeof text !== 'string' || text.trim() === '') {
        return []
    }

    const norm = text.replace(/\s+/g, ' ').trim()
    const tokens = norm.split(/\s+/)

    const stopwords = new Set([
        'The', 'A', 'An', 'In', 'On', 'At', 'By', 'For', 'With', 'About', 'Against', 'Between', 'Into', 'Through', 'During', 'Before', 'After', 'Above', 'Below', 'To', 'From', 'Up', 'Down', 'Over', 'Under', 'Again', 'Further', 'Then', 'Once'
    ])

    const result: string[] = []
    const seen = new Set<string>()

    const trimPunct = (s: string): string => s.replace(/^[^A-Za-z0-9'`-]+|[^A-Za-z0-9'`-]+$/g, '')

    const isAbbreviation = (raw: string): boolean => {
        if (!raw) {
            return false
        }
        // detect common honorifics/abbreviations like "Mr.", "Dr.", "U.S." etc.
        if (!raw.includes('.')) {
            return false
        }
        // keep only letters and dots, then remove dots to count letters
        const letters = raw.replace(/[^A-Za-z.]/g, '').replace(/\./g, '')
        return letters.length <= 2
    }

    const isCapitalizedWord = (raw: string): boolean => {
        if (!raw) {
            return false
        }
        if (isAbbreviation(raw)) {
            return false
        }
        const t = trimPunct(raw)
        if (t === '') {
            return false
        }
        if (/^[A-Z]{2,}$/.test(t)) {
            return false
        }
        return /^[A-Z]/.test(t)
    }

    for (let i = 0; i < tokens.length; i++) {
        const raw = tokens[i]
        const tok = trimPunct(raw)
        if (tok === '') {
            continue
        }

        if (isAbbreviation(raw)) {
            continue
        }
        if (!isCapitalizedWord(raw)) {
            continue
        }
        if (stopwords.has(tok)) {
            continue
        }

        const prev = tokens[i - 1]
        const next = tokens[i + 1]
        // Skip middle tokens of a multi-word capitalized run (e.g. "New York City": skip "New" and "York")
        if (prev && next && isCapitalizedWord(prev) && isCapitalizedWord(next)) {
            continue
        }
        // Skip the first token of a multi-word capitalized run (it is followed by another capitalized token)
        if (next && isCapitalizedWord(next)) {
            continue
        }

        if (!seen.has(tok)) {
            seen.add(tok)
            result.push(tok)
        }
    }

    return result
}
