/**
 * @param array1 The array of strings
 * @param array2 The target array of strings
 * @returns The edit distance of array1 and array2
 */
export function calculateEditDistance(array1: string[], array2: string[]): number {
    const m = array1.length
    const n = array2.length

    // Create a 2D array to store the minimum operations
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array<number>(n + 1).fill(0))

    // Fill the dp array
    for (let i = 0; i <= m; i++) {
        for (let j = 0; j <= n; j++) {
            if (i === 0) {
                dp[i][j] = j // If array1 is empty, insert all elements of array2
            } else if (j === 0) {
                dp[i][j] = i // If array2 is empty, delete all elements of array1
            } else {
                const cost = array1[i - 1] === array2[j - 1] ? 0 : 1 // If elements are the same, no cost
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1, // Deletion
                    dp[i][j - 1] + 1, // Insertion
                    dp[i - 1][j - 1] + cost // Substitution
                )
            }
        }
    }
    return dp[m][n]
}

/**
 * Finds the positions in documentText that best match searchString using edit distance.
 * Strings are split by continuous whitespace.
 * Window sizes vary to accommodate potential matches of different lengths.
 *
 * @param documentText The source string to search within
 * @param searchString The target string to find
 * @returns Array of [start, end] offset pairs (character positions) where the best matches start and end
 */
export function findBestMatches(documentText: string, searchString: string): [number, number][] {
    if (documentText.length === 0 || searchString.length === 0) {
        return []
    }
    // Split strings by continuous whitespace
    const splittedText = documentText.split(/\s+/)
    const searchTokens = searchString.split(/\s+/)

    // If searchTokens is empty or longer than splittedText, no valid match is possible
    if (searchTokens.length === 0 || searchTokens.length > splittedText.length) {
        return []
    }

    // Store best matches
    const bestMatches: [number, number][] = []
    let minDistance = Infinity

    // Define window size variation (check windows of searchTokens.length ± variation)
    const variation = Math.min(2, Math.floor(searchTokens.length / 2))
    const minWindowSize = Math.max(1, searchTokens.length - variation)
    const maxWindowSize = Math.min(splittedText.length, searchTokens.length + variation)

    // Try windows of different sizes
    for (let windowSize = minWindowSize; windowSize <= maxWindowSize; windowSize++) {
        // Try every possible window position
        for (let startIndex = 0; startIndex <= splittedText.length - windowSize; startIndex++) {
            // Create window of tokens in documentText with variable length
            const windowTokens = splittedText.slice(startIndex, startIndex + windowSize)

            // Calculate edit distance between this window and searchString
            const distance = calculateEditDistance(windowTokens, searchTokens)

            // Normalize distance by the maximum length to avoid favoring shorter windows
            const normalizedDistance = distance / Math.max(windowSize, searchTokens.length)

            // If we found a better match, reset and store it
            if (normalizedDistance < minDistance) {
                minDistance = normalizedDistance
                bestMatches.length = 0 // Clear the array
                const startOffset = getCharOffset(documentText, startIndex)
                const endOffset = getCharOffsetEnd(documentText, startIndex, windowSize)
                bestMatches.push([startOffset, endOffset])
            }
            // If we found an equally good match, add it
            else if (normalizedDistance === minDistance) {
                const startOffset = getCharOffset(documentText, startIndex)
                const endOffset = getCharOffsetEnd(documentText, startIndex, windowSize)
                bestMatches.push([startOffset, endOffset])
            }
        }
    }

    return bestMatches
}

/**
 * Calculates the character offset position for a given token index
 *
 * @param text The full text string
 * @param tokenIndex The index of the token in the split array
 * @returns The character offset in the original string
 */
function getCharOffset(text: string, tokenIndex: number): number {
    const tokens = text.split(/\s+/)

    // Handle edge cases
    if (tokenIndex >= tokens.length) {
        return text.length
    }
    if (tokenIndex <= 0) {
        // Find first non-whitespace character
        const match = text.match(/\S/)
        return match ? match.index! : 0
    }

    // Calculate offset by counting characters in preceding tokens plus whitespace
    let offset = 0
    for (let i = 0; i < tokenIndex; i++) {
        offset = text.indexOf(tokens[i], offset) + tokens[i].length

        // Skip any whitespace after the token
        while (offset < text.length && /\s/.test(text[offset])) {
            offset++
        }
    }

    return offset
}

/**
 * Calculates the end character offset position for a given token range
 *
 * @param text The full text string
 * @param tokenStartIndex The index of the first token in the range
 * @param tokenCount The number of tokens in the range
 * @returns The character offset of the end of the range in the original string
 */
function getCharOffsetEnd(text: string, tokenStartIndex: number, tokenCount: number): number {
    const tokens = text.split(/\s+/)

    // Calculate the end token index
    const endTokenIndex = tokenStartIndex + tokenCount - 1

    // Handle edge cases
    if (endTokenIndex >= tokens.length) {
        return text.length
    }

    // Find the position of the last token in the range
    let offset = 0
    for (let i = 0; i <= endTokenIndex; i++) {
        offset = text.indexOf(tokens[i], offset)

        // If this is the last token in our range, add its length to get the end offset
        if (i === endTokenIndex) {
            offset += tokens[i].length
        } else {
            offset += tokens[i].length

            // Skip any whitespace after the token
            while (offset < text.length && /\s/.test(text[offset])) {
                offset++
            }
        }
    }

    return offset
}
