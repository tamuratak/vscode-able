export interface MochaJsonResult {
    readonly stats: MochaStats
    readonly tests: MochaTestResult<unknown>[]
    readonly pending: MochaTestResult<unknown>[]
    readonly failures: MochaTestResult<MochaTestError>[]
    readonly passes: MochaTestResult<unknown>[]
}

interface MochaStats {
    readonly suites: number
    readonly tests: number
    readonly passes: number
    readonly pending: number
    readonly failures: number
    readonly start: string
    readonly end: string
    readonly duration: number
}

interface MochaTestError {
    readonly stack: string
    readonly message: string
    readonly generatedMessage: boolean
    readonly name: string
    readonly code: string
    readonly actual: string
    readonly expected: string
    readonly operator?: string | undefined
}

interface MochaTestResult<T> {
    readonly title: string
    readonly fullTitle: string
    readonly file: string
    readonly duration: number
    readonly currentRetry: number
    readonly speed?: string
    readonly err: T
}

export function removeBeforeFirstBrace(input: string): string {
    if (input.startsWith('{')) {
        return input
    }
    const index = input.indexOf('\n{\n')
    if (index === -1) {
        return input
    }
    // Remove everything before the first '{'
    // Also remove '\n' before it with the `+1` offset.
    return input.slice(index + 1)
}

export function parseMochaJsonOutput(output: string) {
    const json = removeBeforeFirstBrace(output)
    const mochaResult = JSON.parse(json) as MochaJsonResult
    return mochaResult
}

export interface Failure {
    filePath: string
    line: number
    column: number
    failure: MochaTestResult<MochaTestError>
}

export function collectMochaJsonFailures(output: string) {
    const mochaResult = parseMochaJsonOutput(output)
    const failures = mochaResult.failures
    const result: Failure[] = []
    for (const failure of failures) {
        const match = /\(([^:]+):(\d+):(\d+)\)/.exec(failure.err.stack)
        if (match) {
            result.push({
                filePath: match[1],
                line: parseInt(match[2], 10),
                column: parseInt(match[3], 10),
                failure
            })
        }
    }
    return result
}
