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

    // Remove trailing English possessive ('s or ’s) from a token when present.
    // This preserves internal apostrophes (O'Connor) and hyphens (Jean-Paul).
    const stripPossessive = (s: string): string => s.replace(/(?:['’]s)$/i, '')

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
        // strip trailing possessive so "Alice's" -> "Alice"
        const base = stripPossessive(tok)
        if (tok === '') {
            continue
        }

        if (base === '') {
            continue
        }

        if (isAbbreviation(raw)) {
            continue
        }
        if (!isCapitalizedWord(base)) {
            continue
        }
        if (stopwords.has(base)) {
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

        if (!seen.has(base)) {
            seen.add(base)
            result.push(base)
        }
    }

    return result
}

/**
 * Parse lines like "- Alice: アリス" or "Alice: アリス" into a Map
 * Returns a Map where the left side (before the first colon) is the key
 * and the right side (after the first colon) is the value. Later entries
 * overwrite earlier ones for the same key.
 */
export function parseNameMap(text: string): Map<string, string> {
    if (typeof text !== 'string' || text.trim() === '') {
        return new Map()
    }
    const out = new Map<string, string>()
    const lines = text.split(/\r?\n/)
    for (const raw of lines) {
        let line = raw.trim()
        if (line === '') {
            continue
        }
        // remove common bullet markers at the start
        line = line.replace(/^-\s*/, '')
        // split on the first ASCII or fullwidth colon
        const m = line.match(/^(.*?)\s*:\s*(.*)$/)
        if (!m) {
            // skip lines that don't look like key:value
            continue
        }
        const key = m[1].trim()
        const val = m[2].trim()
        if (key === '' || val === '') {
            continue
        }
        out.set(key, val)
    }

    return out
}

