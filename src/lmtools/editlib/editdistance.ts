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
