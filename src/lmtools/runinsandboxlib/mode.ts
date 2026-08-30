export type RunInSandboxMode = 'on' | 'skip' | 'allow'

export type RunInSandboxAction = 'sandbox' | 'sandbox-auto' | 'sandbox-confirm' | 'skip'

// Decides what to do with a tool call from the current mode and whether the
// command is pre-approved by the validator. The sandbox is always used; the
// mode only changes how unapproved commands are handled (confirm, skip, or
// auto-approve).
export function resolveRunAction(mode: RunInSandboxMode, isAllowed: boolean): RunInSandboxAction {
    if (isAllowed) {
        return 'sandbox'
    }
    if (mode === 'allow') {
        return 'sandbox-auto'
    }
    if (mode === 'skip') {
        return 'skip'
    }
    return 'sandbox-confirm'
}

export function nextRunInSandboxMode(mode: RunInSandboxMode): RunInSandboxMode {
    if (mode === 'on') {
        return 'skip'
    }
    if (mode === 'skip') {
        return 'allow'
    }
    return 'on'
}
