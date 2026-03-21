type BrowserTypeName = 'chromium' | 'firefox' | 'webkit'

export interface RunnerConfig {
    browserType: BrowserTypeName
    headless: boolean
}

export interface ExecRequest {
    id: string
    type: 'exec'
    code: string
}

export interface ResetRequest {
    id: string
    type: 'reset'
}

export interface DisposeRequest {
    id: string
    type: 'dispose'
}

export interface InitRequest {
    id: string
    type: 'init'
    config: RunnerConfig
}

export type RequestMessage = ExecRequest | ResetRequest | DisposeRequest | InitRequest

export function parseRunnerMessage(line: string, defaultConfig: RunnerConfig): RequestMessage | undefined {
    let parsed: unknown
    try {
        parsed = JSON.parse(line)
    } catch {
        return undefined
    }

    if (!isRecord(parsed)) {
        return undefined
    }

    const id = getString(parsed, 'id')
    const type = getString(parsed, 'type')
    if (!id || !type) {
        return undefined
    }

    if (type === 'exec') {
        const code = getString(parsed, 'code')
        if (!code) {
            return undefined
        }
        return {
            id,
            type: 'exec',
            code
        }
    }

    if (type === 'reset') {
        return {
            id,
            type: 'reset'
        }
    }

    if (type === 'dispose') {
        return {
            id,
            type: 'dispose'
        }
    }

    if (type === 'init') {
        const config = parseRunnerConfig(parsed, defaultConfig)
        if (!config) {
            return undefined
        }
        return {
            id,
            type: 'init',
            config
        }
    }

    return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function getString(value: Record<string, unknown>, key: string): string | undefined {
    const field = value[key]
    if (typeof field === 'string') {
        return field
    }
    return undefined
}

function getBoolean(value: Record<string, unknown>, key: string): boolean | undefined {
    const field = value[key]
    if (typeof field === 'boolean') {
        return field
    }
    return undefined
}

function parseRunnerConfig(parsed: Record<string, unknown>, defaultConfig: RunnerConfig): RunnerConfig | undefined {
    const configValue = parsed['config']
    if (!isRecord(configValue)) {
        return undefined
    }

    const browserType = getString(configValue, 'browserType')
    const headless = getBoolean(configValue, 'headless')

    return {
        browserType: (browserType === 'chromium' || browserType === 'firefox' || browserType === 'webkit') ? browserType : defaultConfig.browserType,
        headless: headless ?? defaultConfig.headless
    }
}
