export function accumulateScreenshotBytes(
    currentTotalBytes: number,
    screenshotBytes: number,
    screenshotMaxBytes: number,
    screenshotTotalMaxBytes: number,
): number {
    if (screenshotBytes > screenshotMaxBytes) {
        throw new Error(`screenshot too large: ${String(screenshotBytes)} bytes`)
    }

    const totalBytes = currentTotalBytes + screenshotBytes
    if (totalBytes > screenshotTotalMaxBytes) {
        throw new Error(`total screenshot bytes exceeded: ${String(totalBytes)} bytes`)
    }

    return totalBytes
}
