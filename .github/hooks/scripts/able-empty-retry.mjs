#!/usr/bin/env node
// Stop hook for VS Code Copilot Chat: detects the retry markers that the able
// provider emits when a stream ends without text, tool calls, or a finish
// reason (ABLE_EMPTY_RESPONSE_) or when a request fails with a retryable
// error (ABLE_RETRYABLE_ERROR_), then asks the model to continue. Reads the
// hook input JSON from stdin and writes the hook output JSON to stdout. Exits
// 0 in every non-matching case so the agent stops normally.

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
        const timestamp = new Date().toISOString()
        fs.appendFileSync(DEBUG_LOG_PATH, `[${timestamp}] ${message}\n`)
    } catch {
        // Swallow logging failures: the hook must keep working even when the
        // log directory is not writable.
    }
}

// Markers are HTML comments with a per-emission random hex suffix that the
// provider appends at the end of an assistant message that should be retried.
// Matching anchors on the end of the message (the regex has no ^ anchor), so
// a message ending with the marker matches even when the retryable-error
// marker follows partially streamed text. A literal that merely appears
// somewhere in source code quoted by the model can never match, because the
// suffix is unique per emission and the content would not end with it.
const EMPTY_RESPONSE_MARKER_PATTERN = /<!--\s*ABLE_EMPTY_RESPONSE_[0-9a-f]{8}\s*-->$/
const RETRYABLE_ERROR_MARKER_PATTERN = /<!--\s*ABLE_RETRYABLE_ERROR_[0-9a-f]{8}\s*-->$/

// Retry budget: the agent is allowed to stop once the streak of retry
// markers reaches MAX_RETRIES (so at most MAX_RETRIES - 1 continuations).
// The count is derived from the transcript itself (consecutive retry markers
// at the end), so no state file is needed and parallel sessions never race.
const MAX_RETRIES = 10

function readStdin() {
    return new Promise((resolve, reject) => {
        let data = ''
        process.stdin.setEncoding('utf8')
        process.stdin.on('data', chunk => { data += chunk })
        process.stdin.on('end', () => resolve(data))
        process.stdin.on('error', reject)
    })
}

// Counts how many consecutive retry markers (empty response or retryable
// error) appear at the end of the transcript. User messages (the "Please
// continue" nudges and the like) are skipped, so a chain of retried turns
// separated by nudges counts as one streak; the first real assistant response
// breaks the streak, which resets the budget automatically.
function countConsecutiveRetryMarkers(transcriptPath) {
    let stat
    try {
        stat = fs.statSync(transcriptPath)
    } catch {
        return 0
    }
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) {
        return 0
    }
    let text
    try {
        text = fs.readFileSync(transcriptPath, 'utf8')
    } catch {
        return 0
    }
    const entries = []
    for (const line of text.split('\n')) {
        if (!line.trim()) {
            continue
        }
        let entry
        try {
            entry = JSON.parse(line)
        } catch {
            continue
        }
        entries.push(entry)
    }
    let count = 0
    for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i]
        if (entry.type === 'user.message') {
            continue
        }
        if (entry.type !== 'assistant.message' || typeof entry.data?.content !== 'string') {
            continue
        }
        const content = entry.data.content.trim()
        if (EMPTY_RESPONSE_MARKER_PATTERN.test(content) || RETRYABLE_ERROR_MARKER_PATTERN.test(content)) {
            count++
            continue
        }
        break
    }
    return count
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

    // stop_hook_active is intentionally ignored: an empty-response streak
    // often needs several consecutive retries, so a previous "continue" nudge
    // must not suppress the next one. The transcript-derived retry budget
    // (MAX_RETRIES) is what bounds the total.

    const transcriptPath = input.transcript_path
    if (typeof transcriptPath !== 'string' || transcriptPath.length === 0) {
        debugLog(`exit: no transcript_path in input: ${JSON.stringify(input)}`)
        process.exit(0)
    }
    debugLog(`transcript_path=${transcriptPath}`)

    const markerCount = countConsecutiveRetryMarkers(transcriptPath)
    if (markerCount === 0) {
        debugLog('exit: last assistant content is not a retry marker')
        process.exit(0)
    }

    if (markerCount >= MAX_RETRIES) {
        debugLog(`exit: retry limit reached (${markerCount}/MAX_RETRIES consecutive retry markers); letting the agent stop`)
        process.exit(0)
    }

    debugLog(`match: retry marker detected (${markerCount} consecutive), blocking stop`)
    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'Stop',
            decision: 'block',
            reason: "Please continue and complete the user's request.",
        },
    }))
}

main().catch(error => {
    debugLog(`exit: unexpected error: ${error}`)
    process.exit(0)
})
