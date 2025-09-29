// English proper noun extractor utilities
// Comments in English. Main interface: extractProperNouns(text) -> string[]

export function extractProperNouns(text: string): string[] {
    if (typeof text !== 'string' || text.trim() === '') {
        return []
    }

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

    const isProperNoun = (raw: string): boolean => {
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
        // exclude tokens containing digits (e.g., Area51, Bob2)
        if (/[0-9]/.test(t)) {
            return false
        }
        if (/^[A-Z]{2,}$/.test(t)) {
            return false
        }
        return /^[A-Z]/.test(t)
    }

    const norm = text.replace(/\s+/g, ' ').trim()
    const tokens = norm.split(/[\s[\]()<>#]+/)

    // Common English stopwords that are capitalized at the start of sentences
    const stopwords = new Set([
        'The', 'A', 'An', 'In', 'On', 'At', 'By', 'For', 'With', 'About', 'Against', 'Between',
        'Into', 'Through', 'During', 'Before', 'After', 'Above', 'Below', 'To', 'From',
        'Up', 'Down', 'Over', 'Under', 'Again', 'Further', 'Then', 'Once',
        'But', 'Or', 'Nor', 'So', 'Yet', 'And', 'Of', 'Is', 'Are', 'Was', 'Were',
        'Be', 'Been', 'Being', 'Have', 'Has', 'Had', 'Do', 'Does', 'Did',
        'Would', 'Shall', 'Should', 'Can', 'Could', 'Might', 'Must',
    ])

    const result: string[] = []
    const seen = new Set<string>()

    for (const raw of tokens) {
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
        if (!isProperNoun(base)) {
            continue
        }
        if (stopwords.has(base)) {
            continue
        }

        // Defensive: skip tokens that contain digits or are all-uppercase
        if (/[0-9]/.test(base)) {
            continue
        }
        if (/^[A-Z]{2,}$/.test(base)) {
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

const keepInEnglish = new Set(['OpenAI', 'DeepMind', 'DeepSeek', 'DeepL', 'GitHub', 'VSCode', 'JavaScript', 'TypeScript', 'Python', 'Java', 'Rust', 'Node.js', 'React', 'Angular', 'Vue.js', 'Deno', 'NPM', 'Yarn', 'Docker', 'Kubernetes', 'TikTok', 'YouTube', 'Facebook', 'Meta', 'Google', 'Microsoft', 'Apple', 'Amazon', 'Netflix', 'Zoom', 'Spotify', 'Shopify', 'LinkedIn', 'Linux', 'Unix', 'Windows', 'Mac', 'Ubuntu', 'Fedora', 'CentOS', 'Debian', 'PostgreSQL', 'MySQL', 'SQLite', 'MongoDB', 'Redis', 'GraphQL'])

const userDefinedMap = new Map<string, string>([
    ['Iger', 'アイガー']
])

export function selectProperNounsInEnglish(nameMap: Map<string, string>, text: string): Map<string, string> {
    const properNounsInText = extractProperNouns(text)
    const properNounsMapInSet = new Set(properNounsInText)
    const out = new Map<string, string>()
    for (const [key, val] of nameMap) {
        if (!properNounsMapInSet.has(key)) {
            continue
        }
        if (keepInEnglish.has(key)) {
            out.set(key, key)
        } else if (userDefinedMap.has(key)) {
            out.set(key, userDefinedMap.get(key)!)
        } else {
            out.set(key, val)
        }
    }
    return out
}
