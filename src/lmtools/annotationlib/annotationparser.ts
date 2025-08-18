export interface MatchInfo {
    varname: string
    localLine: number
    localCol: number
    localIndexInText: number
}

// Extract identifiers and their local positions from a code fragment.
// Returned MatchInfo objects have line/column relative to the provided text.
export function parseVarMatchesFromText(text: string): MatchInfo[] {
    // patterns to find varnames inside the provided text
    const patterns: { regex: RegExp, kind: 'single' | 'destruct' | 'params' }[] = [
        { regex: /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g, kind: 'single' },
        { regex: /\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\b/g, kind: 'single' },
        { regex: /\bfor\s*await\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+of\b/g, kind: 'single' },
        { regex: /\b(?:const|let|var)\s*\{([^}]+)\}\s*=/g, kind: 'destruct' },
        { regex: /\b(?:const|let|var)\s*\[([^\]]+)\]\s*=/g, kind: 'destruct' },
        // arrow-function parameter lists like (a, b) => or inside calls: v.mthd((a,b) => { ... })
        { regex: /\(\s*([A-Za-z_$][\w$]*(?:\s*,\s*[A-Za-z_$][\w$]*)*)\s*\)\s*=>/g, kind: 'params' },
        { regex: /\bcatch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/g, kind: 'single' }
    ]

    // helper to extract identifiers from destructuring lists
    const extractIdsFromList = (s: string) => {
        return s.split(',')
            .map(p => p.trim())
            .map(p => {
                // prefer property renames like "b: alias" over the original property name
                const m2 = p.match(/:\s*([A-Za-z_$][\w$]*)/)
                if (m2) {
                    return m2[1]
                }
                // otherwise fall back to leading simple identifier (also handles defaults like "b = 1")
                const m = p.match(/^([A-Za-z_$][\w$]*)/)
                if (m) {
                    return m[1]
                }
                return null
            })
            .filter(Boolean) as string[]
    }

    const matches: MatchInfo[] = []

    const textLines = text.split(/\r?\n/)
    for (let li = 0; li < textLines.length; li++) {
        const line = textLines[li]
        for (const pat of patterns) {
            pat.regex.lastIndex = 0
            let m: RegExpExecArray | null
            while ((m = pat.regex.exec(line)) !== null) {
                if (pat.kind === 'single') {
                    const varname = m[1]
                    const col = m.index + line.slice(m.index).indexOf(varname)
                    // compute absolute index within the provided text
                    let indexBefore = 0
                    for (let k = 0; k < li; k++) {
                        indexBefore += textLines[k].length + 1
                    }
                    const localIndexInText = indexBefore + m.index
                    matches.push({
                        varname,
                        localLine: li,
                        localCol: col,
                        localIndexInText
                    })
                } else if (pat.kind === 'destruct') {
                    const list = m[1]
                    const ids = extractIdsFromList(list)
                    for (const id of ids) {
                        const subIndex = line.indexOf(id, m.index)
                        const col = subIndex >= 0 ? subIndex : m.index
                        let indexBefore = 0
                        for (let k = 0; k < li; k++) {
                            indexBefore += textLines[k].length + 1
                        }
                        const localIndexInText = indexBefore + (subIndex >= 0 ? subIndex : m.index)
                        matches.push({
                            varname: id,
                            localLine: li,
                            localCol: col,
                            localIndexInText
                        })
                    }
                } else if (pat.kind === 'params') {
                    const list = m[1]
                    const ids = extractIdsFromList(list)
                    for (const id of ids) {
                        const subIndex = line.indexOf(id, m.index)
                        const col = subIndex >= 0 ? subIndex : m.index
                        let indexBefore = 0
                        for (let k = 0; k < li; k++) {
                            indexBefore += textLines[k].length + 1
                        }
                        const localIndexInText = indexBefore + (subIndex >= 0 ? subIndex : m.index)
                        matches.push({
                            varname: id,
                            localLine: li,
                            localCol: col,
                            localIndexInText
                        })
                    }
                }
            }
        }
    }

    return matches
}

/**
 * annotationparser.ts — concise reference
 *
 * What it is
 * - A small, dependency-free parser that heuristically finds variable bindings
 *   in a TypeScript/JavaScript code fragment and returns a list of
 *   MatchInfo entries with positions relative to the input text.
 *
 * Exports
 * - MatchInfo { varname, localLine, localCol, localIndexInText }
 * - parseVarMatchesFromText(text: string): MatchInfo[]
 *
 * Detection (summary)
 * - Simple declarations: `const|let|var name = ...`
 * - For-of / for-await: `for (const name of ...)`, `for await (const name of ...)`
 * - Object destructuring: `const { a, b: alias } = ...` (alias preferred)
 * - Array destructuring: `const [x, , y] = ...`
 * - catch param: `catch (err)`
 *
 * Limitations
 * - Heuristic only: no AST parsing → misses nested destructuring, rest,
 *   computed properties, and some multi-line patterns
 * - Returns offsets relative to the provided text (caller maps to document
 *   positions if needed)
 *
 * Example (parseVarMatchesFromText)
 * Input `text` (a code fragment):
 * ```ts
 * const items = getItems()
 * for (const it of items) {
 *     const { id, value: v } = it
 *     let count = 0
 * }
 * ```
 * Output (returned MatchInfo[]):
 * ```json
 * [
 *   { "varname": "items", "localLine": 0, "localCol": 6, "localIndexInText": 6 },
 *   { "varname": "it", "localLine": 1, "localCol": 11, "localIndexInText": 36 },
 *   { "varname": "id", "localLine": 2, "localCol": 12, "localIndexInText": 63 },
 *   { "varname": "v", "localLine": 2, "localCol": 23, "localIndexInText": 74 },
 *   { "varname": "count", "localLine": 3, "localCol": 8, "localIndexInText": 91 }
 * ]
 * ```
 *
 * Notes & next steps
 * - Keep this module dependency-free so tests and LLMs can import it easily.
 * - For production-grade accuracy, replace with TypeScript Compiler API
 *   extraction (recommended as a follow-up).
 */

