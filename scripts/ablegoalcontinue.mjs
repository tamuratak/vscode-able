#!/usr/bin/env node
// Stop hook for VS Code Copilot Chat: goal mode auto-continuation.
//
// The able provider (src/chatprovider/opencodegochatprovider/goal.ts) supports
// a /goal command that records an objective as an ABLE_GOAL_SET_ marker inside
// an assistant message. While a goal is active, this hook blocks the agent's
// stop so the model keeps working toward the goal until it ends a response
// with the ABLE_GOAL_COMPLETE_ or ABLE_GOAL_BLOCKED_ marker, mirroring the
// codex /goal slash command. The marker format MUST stay in sync with
// GOAL_MARKER_PATTERN in goal.ts. Exits 0 in every non-matching case so the
// agent stops normally.

import fs from 'node:fs'
import path from 'node:path'

// Debug log destination. Every decision point is appended here so hook
// execution can be verified without attaching a debugger. Logging must never
// break the hook itself, so every write is wrapped in try/catch.
const DEBUG_LOG_DIR = '/Users/tamura/.copilot/logs'
const DEBUG_LOG_PATH = path.join(DEBUG_LOG_DIR, 'hooks.log')

function debugLog(message) {
    try {
        fs.mkdirSync(DEBUG_LOG_DIR, { recursive: true })
        // Log in Japan time (Asia/Tokyo) so entries are readable in the local timezone.
        const timestamp = new Date().toLocaleString('ja-JP', {
            timeZone: 'Asia/Tokyo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            timeZoneName: 'short',
        })
        fs.appendFileSync(DEBUG_LOG_PATH, `[${timestamp}] ${message}\n`)
    } catch {
        // Swallow logging failures: the hook must keep working even when the
        // log directory is not writable.
    }
}

// Must stay in sync with GOAL_MARKER_PATTERN in
// src/chatprovider/opencodegochatprovider/goal.ts.
const GOAL_MARKER_PATTERN = /<!--\s*ABLE_GOAL_(SET|CLEAR|COMPLETE|BLOCKED|PAUSED)_([0-9a-f]{8})(?:\s+([0-9a-f]+))?\s*-->/g

// Terminal retry markers owned by able-empty-retry.mjs: when the latest
// assistant message ends with one of these, that hook owns the continuation
// and this hook must not fire on top of it.
const RETRY_MARKER_PATTERNS = [
    /<!--\s*ABLE_EMPTY_RESPONSE_[0-9a-f]{8}\s*-->$/,
    /<!--\s*ABLE_RETRYABLE_ERROR_[0-9a-f]{8}\s*-->$/,
]

// Continuation budget: the agent stops once the number of assistant turns
// after the goal was set reaches MAX_GOAL_TURNS. stop_hook_active is
// intentionally ignored for the same reason as in able-empty-retry.mjs: a goal
// legitimately needs many consecutive continuations, and the transcript-derived
// budget below is what bounds the total.
const MAX_GOAL_TURNS = 20

function readStdin() {
    return new Promise((resolve, reject) => {
        let data = ''
        process.stdin.setEncoding('utf8')
        process.stdin.on('data', chunk => { data += chunk })
        process.stdin.on('end', () => resolve(data))
        process.stdin.on('error', reject)
    })
}

function decodeObjectivePayload(payload) {
    if (typeof payload !== 'string' || payload.length === 0 || payload.length % 2 !== 0 || !/^[0-9a-f]+$/.test(payload)) {
        return null
    }
    try {
        return Buffer.from(payload, 'hex').toString('utf8')
    } catch {
        return null
    }
}

function entryText(entry) {
    if (entry === null || typeof entry !== 'object' || (entry.type !== 'user.message' && entry.type !== 'assistant.message')) {
        return ''
    }
    const raw = entry.data?.content
    if (typeof raw === 'string') {
        return raw
    }
    if (Array.isArray(raw)) {
        // Content may be an array of parts; join the text parts.
        return raw
            .filter(p => p && p.type === 'text' && typeof p.text === 'string')
            .map(p => p.text)
            .join('\n')
    }
    return ''
}

function readEntries(transcriptPath) {
    let stat
    try {
        stat = fs.statSync(transcriptPath)
    } catch {
        return []
    }
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) {
        return []
    }
    let text
    try {
        text = fs.readFileSync(transcriptPath, 'utf8')
    } catch {
        return []
    }
    const entries = []
    for (const line of text.split('\n')) {
        if (!line.trim()) {
            continue
        }
        try {
            entries.push(JSON.parse(line))
        } catch {
            continue
        }
    }
    return entries
}

function deriveGoalState(entries) {
    let status = 'none'
    let objective = null
    let setEntryIndex = -1
    for (let index = 0; index < entries.length; index++) {
        const text = entryText(entries[index])
        if (!text) {
            continue
        }
        for (const match of text.matchAll(GOAL_MARKER_PATTERN)) {
            const kind = match[1]
            if (kind === 'SET') {
                const decoded = decodeObjectivePayload(match[3])
                if (decoded === null || decoded.length === 0) {
                    continue
                }
                status = 'active'
                objective = decoded
                setEntryIndex = index
            } else if (kind === 'CLEAR' || kind === 'COMPLETE' || kind === 'BLOCKED') {
                status = 'none'
                objective = null
                setEntryIndex = -1
            } else if (status === 'active') {
                // PAUSED
                status = 'paused'
            }
        }
    }
    let turns = 0
    for (let index = setEntryIndex + 1; index < entries.length; index++) {
        if (entries[index]?.type === 'assistant.message') {
            turns++
        }
    }
    return { status, objective, turns }
}

function lastAssistantEntry(entries) {
    for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index]
        if (entry && entry.type === 'assistant.message') {
            return entry
        }
    }
    return null
}

async function main() {
    let input
    try {
        input = JSON.parse(await readStdin())
    } catch (error) {
        debugLog(`exit: failed to parse stdin JSON: ${error}`)
        process.exit(0)
    }
    debugLog(`invoked: session_id=${input.session_id} cwd=${input.cwd ?? '(none)'}`)

    const transcriptPath = input.transcript_path
    if (typeof transcriptPath !== 'string' || transcriptPath.length === 0) {
        debugLog(`exit: no transcript_path in input: ${JSON.stringify(input)}`)
        process.exit(0)
    }
    debugLog(`transcript_path=${transcriptPath}`)

    const entries = readEntries(transcriptPath)
    const { status, objective, turns } = deriveGoalState(entries)
    if (status !== 'active' || objective === null) {
        debugLog(`exit: goal status is ${status}`)
        process.exit(0)
    }

    const lastAssistant = lastAssistantEntry(entries)
    if (lastAssistant !== null) {
        const text = entryText(lastAssistant).trim()
        if (RETRY_MARKER_PATTERNS.some(pattern => pattern.test(text))) {
            debugLog('exit: latest assistant message ends with a retry marker; able-empty-retry owns the continuation')
            process.exit(0)
        }
    }

    if (turns >= MAX_GOAL_TURNS) {
        debugLog(`exit: goal turn limit reached (${turns}/${MAX_GOAL_TURNS}); letting the agent stop`)
        process.exit(0)
    }

    const reason = [
        `Please continue and complete the active goal: ${objective}`,
        '',
        'Keep making concrete progress toward the full objective without shrinking its scope or redefining success. End your final response with the goal complete marker only when the completion audit in the goal instructions proves every requirement is satisfied; end your final response with the goal blocked marker only when the blocked audit is satisfied.',
    ].join('\n')
    debugLog(`match: active goal detected (${turns}/${MAX_GOAL_TURNS} turns used), blocking stop`)
    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'Stop',
            decision: 'block',
            reason,
        },
    }))
}

main().catch(error => {
    debugLog(`exit: unexpected error: ${error}`)
    process.exit(0)
})
