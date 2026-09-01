export type RunInSandboxMode = 'on' | 'skip' | 'allow'

/**
  'sandbox': Pre-approved command: run it in the sandbox without confirmation (in every mode)
  'sandbox-auto': Unapproved command in allow mode: run it in the sandbox without asking the user
  'sandbox-confirm': Unapproved command in on mode: ask the user for confirmation, then run it in the sandbox
  'skip': Unapproved command in skip mode: do not run it and tell the model it was skipped
 */
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
