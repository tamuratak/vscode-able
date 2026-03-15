export interface PlaywrightReplExecRequest {
    type: 'exec'
    id: string
    code: string
    timeoutms: number
}

export interface PlaywrightReplResetRequest {
    type: 'reset'
    id: string
}

export interface PlaywrightReplHostCallRequest {
    type: 'pwcall'
    id: string
    method: string
    args: readonly string[]
}

export interface PlaywrightReplHostCallResult {
    type: 'pwresult'
    id: string
    ok: boolean
    value?: string
    error?: string
}

export interface PlaywrightReplExecResult {
    type: 'result'
    id: string
    ok: boolean
    value?: string
    error?: string
    logs: readonly string[]
}

export interface PlaywrightReplScreenshot {
    mimetype: 'image/png' | 'image/jpeg'
    data: string
    bytes: number
}

export type PlaywrightReplKernelToHostMessage = PlaywrightReplHostCallRequest | PlaywrightReplExecResult

export type PlaywrightReplHostToKernelMessage = PlaywrightReplExecRequest | PlaywrightReplResetRequest | PlaywrightReplHostCallResult
