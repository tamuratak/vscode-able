
export function toCunks(text: string, chunkSize: number): string[] {
    const inputs = text.split('\n\n')
    const chunks: string[] = []
    let currentChunk = ''
    for (const input of inputs) {
        const candidate = currentChunk ? currentChunk + '\n\n' + input : input
        if (candidate.length <= chunkSize) {
            currentChunk = candidate
        } else {
            if (currentChunk) {
                chunks.push(currentChunk)
            }
            currentChunk = input
        }
    }
    return [...chunks, currentChunk]
}
