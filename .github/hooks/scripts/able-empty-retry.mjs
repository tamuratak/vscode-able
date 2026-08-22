#!/usr/bin/env node
// Stop hook for VS Code Copilot Chat: detects the empty-response marker that
// the able provider emits when a stream ends without text, tool calls, or a
// finish reason, then asks the model to continue. Reads the hook input JSON
// from stdin and writes the hook output JSON to stdout. Exits 0 in every
// non-matching case so the agent stops normally.

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

// The marker is an HTML comment with a per-emission random hex suffix. The
// whole content of an assistant message must match exactly; a literal that
// merely appears somewhere in source code quoted by the model can never
// match, because the suffix is unique per emission and the content would
// contain surrounding text.
const STOP_MARKER_PATTERN = /<!--\s*ABLE_EMPTY_RESPONSE_[0-9a-f]{8}\s*-->$/

// Retry budget: an empty response may be retried at most this many times
// before the agent is allowed to stop. The count is derived from the
// transcript itself (consecutive empty-response markers at the end), so no
// state file is needed and parallel sessions never race.
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

// Counts how many consecutive empty-response markers appear at the end of
// the transcript. User messages (the "Please continue" nudges and the like)
// are skipped, so a chain of empty responses separated by nudges counts as
// one streak; the first real assistant response breaks the streak, which
// resets the budget automatically.
function countConsecutiveEmptyMarkers(transcriptPath) {
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
        if (STOP_MARKER_PATTERN.test(entry.data.content.trim())) {
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

    const markerCount = countConsecutiveEmptyMarkers(transcriptPath)
    if (markerCount === 0) {
        debugLog('exit: last assistant content is not an empty-response marker')
        process.exit(0)
    }

    if (markerCount >= MAX_RETRIES) {
        debugLog(`exit: retry limit reached (${markerCount}/MAX_RETRIES consecutive empty responses); letting the agent stop`)
        process.exit(0)
    }

    debugLog(`match: empty-response marker detected (${markerCount} consecutive), blocking stop`)
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
