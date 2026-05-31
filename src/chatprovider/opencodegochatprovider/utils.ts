export interface RepetitionResult {
    pattern: string
    count: number
}

const MIN_WORDS = 20
const MAX_TAIL_LENGTH = 8000
// Minimum fraction of consecutive word-matches required out of the candidate
// period length for a candidate to be accepted as a true repetition.
// A higher value (e.g. 0.9) reduces false positives by requiring near-exact repeats.
const MIN_MATCH_RATIO = 0.9
const ABSOLUTE_MIN_MATCHES = 5

/**
 * Detects whether the given text ends with a repeating pattern,
 * which may indicate an infinite loop in LLM reasoning output.
 *
 * The algorithm:
 * 1. Tokenize the tail of the text into words with character positions
 * 2. Use the last ~30 words as probes to find candidate word-periods
 *    by locating earlier occurrences of each probe word
 * 3. Cluster nearby candidate periods and pick the strongest one
 * 4. Verify by counting consecutive word-matches from the end
 *    when shifted by the candidate period
 * 5. Return the pattern and repetition count if at least 2 full
 *    repetitions are found
 */
export function findRepeatingPattern(text: string): RepetitionResult | null {
    const tail = text.length > MAX_TAIL_LENGTH ? text.slice(-MAX_TAIL_LENGTH) : text

    // Step 1: Tokenize into words with character positions
    const tokens: { word: string; start: number; end: number }[] = []
    const wordRe = /\S+/g
    let m: RegExpExecArray | null
    while ((m = wordRe.exec(tail)) !== null) {
        tokens.push({ word: m[0], start: m.index, end: m.index + m[0].length })
    }
    const n = tokens.length
    if (n < MIN_WORDS) {
        return null
    }

    // Step 2: Find candidate word-periods using probe words from the tail
    const probeCount = Math.min(30, Math.floor(n / 3))
    const periodVotes = new Map<number, number>()
    for (let i = n - probeCount; i < n; i++) {
        for (let j = i - 1; j >= 0; j--) {
            if (tokens[j].word === tokens[i].word) {
                const period = i - j
                if (period >= 3) {
                    periodVotes.set(period, (periodVotes.get(period) || 0) + 1)
                }
            }
        }
    }

    // Step 3: Cluster nearby periods and find the best candidate
    const sorted = [...periodVotes.entries()].sort((a, b) => b[1] - a[1])
    if (sorted.length === 0) {
        return null
    }

    const tolerance = 2
    const clusters: { period: number; votes: number }[] = []
    const used = new Set<number>()
    for (const [period, votes] of sorted) {
        if (used.has(period)) {
            continue
        }
        let sum = period * votes
        let totalVotes = votes
        for (const [other, ov] of sorted) {
            if (other !== period && Math.abs(other - period) <= tolerance && !used.has(other)) {
                sum += other * ov
                totalVotes += ov
                used.add(other)
            }
        }
        used.add(period)
        clusters.push({ period: Math.round(sum / totalVotes), votes: totalVotes })
    }
    clusters.sort((a, b) => b.votes - a.votes)

    // Step 4: Verify each candidate period
    for (const { period: wp } of clusters) {
        if (wp < 3 || wp * 2 > n) {
            continue
        }

        // Count consecutive word-matches from the end
        let matchCount = 0
        for (let offset = 0; offset < n; offset++) {
            const idx = n - 1 - offset
            if (idx - wp < 0) {
                break
            }
            if (tokens[idx].word === tokens[idx - wp].word) {
                matchCount++
            } else {
                break
            }
        }

        const minMatches = Math.max(Math.floor(wp * MIN_MATCH_RATIO), ABSOLUTE_MIN_MATCHES)
        if (matchCount < minMatches) {
            continue
        }

        // Step 5: Extract the repeating pattern and count repetitions
        // The verified match region is tokens[n-matchCount .. n-1].
        // Shifting this region back by 'wp' words gives the preceding block,
        // which is guaranteed to be one full period of the pattern.
        const regionStart = Math.max(0, n - matchCount - wp)
        const pattern = tokens.slice(regionStart, regionStart + wp).map(t => t.word).join(' ')
        // Total matched words plus one full period gives the span for all repetitions.
        const count = Math.floor((matchCount + wp) / wp)

        if (count >= 2) {
            return { pattern, count }
        }
    }

    return null
}
