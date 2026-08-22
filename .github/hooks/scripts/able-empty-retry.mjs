#!/usr/bin/env node
// Stop hook for VS Code Copilot Chat: detects the empty-response marker that
// the able provider emits when a stream ends without text, tool calls, or a
// finish reason, then asks the model to continue. Reads the hook input JSON
// from stdin and writes the hook output JSON to stdout. Exits 0 in every
// non-matching case so the agent stops normally.

import fs from 'node:fs'

// The marker is an HTML comment with a per-emission random hex suffix. The
// whole content of the latest assistant message must match exactly; a literal
// that merely appears somewhere in source code quoted by the model can never
// match, because the suffix is unique per emission and the content would
// contain surrounding text.
const STOP_MARKER_PATTERN = /^<!--\s*ABLE_EMPTY_RESPONSE_[0-9a-f]{8}\s*-->$/

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
    } catch {
        process.exit(0)
    }

    // Already continuing as a result of a previous stop-hook block: never
    // block a second time, so the model can legitimately stop after the
    // "continue" nudge.
    if (input.stop_hook_active === true) {
        process.exit(0)
    }

    const transcriptPath = input.transcript_path
    if (typeof transcriptPath !== 'string' || transcriptPath.length === 0) {
        process.exit(0)
    }

    const lastAssistantContent = findLastAssistantContent(transcriptPath)
    if (lastAssistantContent === undefined) {
        process.exit(0)
    }

    if (!STOP_MARKER_PATTERN.test(lastAssistantContent.trim())) {
        process.exit(0)
    }

    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'Stop',
            decision: 'block',
            reason: "Please continue and answer the user's question.",
        },
    }))
}

main().catch(() => process.exit(0))
