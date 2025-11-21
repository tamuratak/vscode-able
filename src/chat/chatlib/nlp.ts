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

    // Common English stopwords that are capitalized at the start of sentences and should not be treated as proper nouns
    const stopwords = new Set([
        'The', 'A', 'An', 'In', 'On', 'At', 'By', 'For', 'With', 'About', 'Against', 'Between',
        'Into', 'Through', 'During', 'Before', 'After', 'Above', 'Below', 'To', 'From',
        'Up', 'Down', 'Over', 'Under', 'Again', 'Further', 'Then', 'Once',
        'But', 'Or', 'Nor', 'So', 'Yet', 'And', 'Of', 'Is', 'Are', 'Was', 'Were',
        'Be', 'Been', 'Being', 'Have', 'Has', 'Had', 'Do', 'Does', 'Did',
        'Would', 'Shall', 'Should', 'Can', 'Could', 'Might', 'Must',
        'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
        'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
        'September', 'October', 'November', 'December',
        'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
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

export function selectProperNounsInEnglish(nameMap: Map<string, string>, text: string): Map<string, string> {
    const keepInEnglish = new Set([
        'OpenAI', 'DeepMind', 'DeepSeek', 'DeepL', 'GitHub', 'VSCode', 'JavaScript', 'TypeScript', 'Python', 'Java', 'Rust', 'Node.js', 'React',
        'Angular', 'Vue.js', 'Deno', 'NPM', 'Yarn', 'Docker', 'Kubernetes',
        'TikTok', 'YouTube', 'Facebook', 'Meta', 'Google', 'Microsoft', 'Apple', 'Amazon', 'Netflix', 'Zoom', 'Spotify', 'Shopify', 'LinkedIn',
        'Linux', 'Unix', 'Windows', 'Mac', 'Ubuntu', 'Fedora', 'CentOS', 'Debian', 'PostgreSQL', 'MySQL', 'SQLite', 'MongoDB', 'Redis', 'GraphQL',
        'Codex', 'GPT-3', 'GPT-4', 'ChatGPT', 'Bard', 'Gemini', 'Claude',
        'Markdown'
    ])
    const userDefinedMap = new Map<string, string>([
        ['Iger', 'アイガー']
    ])
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

/**
 * Check if `target` is the English plural form of `orig`.
 * Case-insensitive and trims surrounding whitespace.
 * Handles common regular rules and a set of irregular plurals.
 */
export function checkIfPlural(orig: string, target: string): boolean {
    const s = orig.trim()
    const t = target.trim()
    if (s === '' || t === '') {
        return false
    }
    const a = s.toLowerCase()
    const b = t.toLowerCase()
    if (a === b) {
        return false
    }

    // Regular patterns
    // 1) sibilant endings -> add "es"
    if (/(s|x|ch|sh|z)$/.test(a)) {
        if (b === a + 'es') {
            return true
        }
    }

    // 2) consonant + y -> ies
    if (/[^aeiou]y$/.test(a)) {
        if (b === a.slice(0, -1) + 'ies') {
            return true
        }
    }

    // 3) vowel + y -> just add s
    if (/[aeiou]y$/.test(a)) {
        if (b === a + 's') {
            return true
        }
    }

    // 4) -f/-fe -> -ves (also allow simple +s as alternates like roofs)
    if (/fe$/.test(a)) {
        if (b === a.slice(0, -2) + 'ves' || b === a + 's') {
            return true
        }
    }
    if (/[^f]f$/.test(a) || /^(?:self|shelf|wolf|leaf|calf|half|loaf|thief|knife|life|wife)$/.test(a)) {
        if (b === a.slice(0, -1) + 'ves' || b === a + 's') {
            return true
        }
    }

    // 5) words ending with 'o' -> usually +s, but some take +es (covered in irregular); accept +s generally
    if (/o$/.test(a)) {
        if (b === a + 's') {
            return true
        }
    }

    // 6) default regular plural: +s (but not for sibilant endings which should use +es)
    if (!/(s|x|ch|sh|z)$/.test(a) && b === a + 's') {
        return true
    }

    // 7) Latin/Greek patterns not covered by irregular map
    //    -us -> -i (already irregular), -is -> -es, -um -> -a (already irregular)
    if (/is$/.test(a)) {
        if (b === a.slice(0, -2) + 'es') {
            return true
        }
    }

    return false
}

/**
 * Remove words that are plural forms of other words in the same array.
 * - Keeps original order of the remaining words
 * - Case-insensitive comparison for plural detection
 * - Trims whitespace around each word for comparison, but returns original strings
 */
export function removePluralForms(words: string[]): string[] {
    if (words.length === 0) {
        return []
    }
    const drop = new Array<boolean>(words.length)
    for (let i = 0; i < words.length; i++) {
        drop[i] = false
    }
    for (let i = 0; i < words.length; i++) {
        const wi = words[i]
        for (let j = 0; j < words.length; j++) {
            if (i === j) {
                continue
            }
            const wj = words[j]
            // If wi is a plural of wj, mark wi to drop
            if (checkIfPlural(wj, wi)) {
                drop[i] = true
                break
            }
        }
    }
    const out: string[] = []
    for (let i = 0; i < words.length; i++) {
        if (!drop[i]) {
            out.push(words[i])
        }
    }
    return out
}

/**
 * Count how many lines from originalText are contained in translatedText.
 * - Trims whitespace from lines for comparison
 * - Ignores empty lines in the original text
 * - Excludes lines with 6 words or fewer from the original text
 * - Case-sensitive comparison
 * - Returns the number of original lines that were found in translatedText
 * - Returns 0 for invalid (non-string) inputs or when no lines are considered
 */
export function countLinesContained(originalText: string, translatedText: string): number {
    if (typeof originalText !== 'string' || typeof translatedText !== 'string') {
        return 0
    }

    const countWords = (line: string): number => {
        return line.split(/\s+/).filter(word => word !== '').length
    }

    const originalLines = originalText.split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line !== '' && countWords(line) > 6)

    const translatedLines = new Set(
        translatedText.split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line !== '')
    )

    let foundCount = 0
    for (const line of originalLines) {
        if (translatedLines.has(line)) {
            foundCount++
        }
    }

    return foundCount
}
