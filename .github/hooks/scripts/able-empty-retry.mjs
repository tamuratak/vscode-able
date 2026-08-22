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
// whole content of the latest assistant message must match exactly; a literal
// that merely appears somewhere in source code quoted by the model can never
// match, because the suffix is unique per emission and the content would
// contain surrounding text.
const STOP_MARKER_PATTERN = /<!--\s*ABLE_EMPTY_RESPONSE_[0-9a-f]{8}\s*-->$/

function readStdin() {
    return new Promise((resolve, reject) => {
        let data = ''
        process.stdin.setEncoding('utf8')
        process.stdin.on('data', chunk => { data += chunk })
        process.stdin.on('end', () => resolve(data))
        process.stdin.on('error', reject)
    })
}

// Returns the content of the most recent assistant.message entry in the
// transcript JSONL, or undefined when the file is unreadable or too large.
function findLastAssistantContent(transcriptPath) {
    let stat
    try {
        stat = fs.statSync(transcriptPath)
    } catch {
        return undefined
    }
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) {
        return undefined
    }
    let text
    try {
        text = fs.readFileSync(transcriptPath, 'utf8')
    } catch {
        return undefined
    }
    let content
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
        if (entry && entry.type === 'assistant.message' && typeof entry.data?.content === 'string') {
            content = entry.data.content
        }
    }
    return content
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

    // Already continuing as a result of a previous stop-hook block: never
    // block a second time, so the model can legitimately stop after the
    // "continue" nudge.
    if (input.stop_hook_active === true) {
//        debugLog('exit: stop_hook_active is true')
//        process.exit(0)
    }

    const transcriptPath = input.transcript_path
    if (typeof transcriptPath !== 'string' || transcriptPath.length === 0) {
        debugLog(`exit: no transcript_path in input: ${JSON.stringify(input)}`)
        process.exit(0)
    }
    debugLog(`transcript_path=${transcriptPath}`)

    const lastAssistantContent = findLastAssistantContent(transcriptPath)
    if (lastAssistantContent === undefined) {
        debugLog('exit: transcript unreadable or last assistant content missing')
        process.exit(0)
    }

    const trimmed = lastAssistantContent.trim()
    if (!STOP_MARKER_PATTERN.test(trimmed)) {
        debugLog(`exit: last assistant content does not match the marker pattern (length=${trimmed.length}, head=${JSON.stringify(trimmed.slice(0, 300))})`)
        process.exit(0)
    }

    debugLog(`match: empty-response marker detected (${trimmed}), blocking stop`)
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
