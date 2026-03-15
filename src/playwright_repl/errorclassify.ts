export function classifyExecutionError(message: string): 'runtime_guard' | 'playwright_runtime' | 'infrastructure' {
    const normalized = message.toLowerCase()
    if (
        normalized.includes('kernel exited unexpectedly')
        || normalized.includes('kernel is not available')
        || normalized.includes('econnreset')
        || normalized.includes('epipe')
    ) {
        return 'infrastructure'
    }

    if (
        normalized.includes('timed out')
        || normalized.includes('not allowed')
        || normalized.includes('disallowed')
        || normalized.includes('import is disabled')
        || normalized.includes('code generation from strings')
        || normalized.includes('syntax guard')
    ) {
        return 'runtime_guard'
    }

    return 'playwright_runtime'
}
