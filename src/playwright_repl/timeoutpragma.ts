export function extractTimeoutOverrideMs(code: string): number | undefined {
    const firstLine = code.split('\n', 1)[0]
    const matched = /^\s*\/\/\s*playwrightrepl-timeout\s*=\s*(\d+)\s*$/.exec(firstLine)
    if (!matched) {
        return undefined
    }

    const value = Number.parseInt(matched[1], 10)
    if (!Number.isFinite(value)) {
        return undefined
    }
    if (value < 100 || value > 60000) {
        return undefined
    }
    return value
}
