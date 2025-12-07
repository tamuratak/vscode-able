export interface SimpleCommand {
    command: string
    args: string[]
}

export interface PipelineSequence {
    pipeline: SimpleCommand[]
}

export interface ParsedCommand {
    sequences: PipelineSequence[]
}

export function parseCommand(command: string): ParsedCommand {
    const sequences: PipelineSequence[] = []

    for (const sequencePart of splitTopLevel(command, '&&')) {
        if (sequencePart.length === 0) {
            continue
        }

        const pipelineParts = splitTopLevel(sequencePart, '|')
            .map((part) => part.trim())
            .filter((part) => part.length > 0)

        const pipeline: SimpleCommand[] = []

        for (const pipelinePart of pipelineParts) {
            const tokens = tokenizeSegment(pipelinePart)
            if (tokens.length === 0) {
                continue
            }

            pipeline.push({ command: tokens[0], args: tokens.slice(1) })
        }

        if (pipeline.length === 0) {
            continue
        }
        sequences.push({ pipeline })
    }

    return { sequences }
}

function splitTopLevel(input: string, delimiter: string): string[] {
    const parts: string[] = []
    let buffer = ''
    let inSingle = false
    let inDouble = false
    let index = 0

    while (index < input.length) {
        const char = input[index]

        // if the quote is escaped, do not toggle
        const escaped = isEscaped(input, index)
        if (char === "'" && !inDouble && !escaped) {
            inSingle = !inSingle
        } else if (char === '"' && !inSingle && !escaped) {
            inDouble = !inDouble
        }

        if (!inSingle && !inDouble && input.startsWith(delimiter, index) && !isEscaped(input, index)) {
            parts.push(buffer.trim())
            buffer = ''
            index += delimiter.length
            continue
        }

        buffer += char
        index += 1
    }

    if (buffer.length > 0) {
        parts.push(buffer.trim())
    }

    return parts.filter((part) => part.length > 0)
}

function isEscaped(input: string, index: number): boolean {
    // count consecutive backslashes immediately before index
    let i = index - 1
    let count = 0
    while (i >= 0 && input[i] === '\\') {
        count += 1
        i -= 1
    }
    return (count % 2) === 1
}

function tokenizeSegment(segment: string): string[] {
    // normalize backslash + newline + optional spaces into backslash+space
    // so that it is handled the same as an escaped space (line continuation)
    segment = segment.replace(/\\\r?\n[ \t]*/g, '\\ ')
    const tokens: string[] = []
    let buffer = ''
    let inSingle = false
    let inDouble = false
    let index = 0

    while (index < segment.length) {
        const char = segment[index]
        const escaped = isEscaped(segment, index)

        if (char === "'" && !inDouble && !escaped) {
            inSingle = !inSingle
        } else if (char === '"' && !inSingle && !escaped) {
            inDouble = !inDouble
        }

        if (!inSingle && !inDouble && char === ' ' && !escaped) {
            if (buffer.length > 0) {
                tokens.push(trimQuotes(buffer))
                buffer = ''
            }
            index += 1
            continue
        }

        buffer += char
        index += 1
    }

    if (buffer.length > 0) {
        tokens.push(trimQuotes(buffer))
    }

    return tokens.filter((token) => token.length > 0)
}

function trimQuotes(value: string): string {
    const trimmed = value.trim()
    if (trimmed.length >= 2) {
        const first = trimmed[0]
        const last = trimmed[trimmed.length - 1]
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            const inner = trimmed.slice(1, -1)
            return unescapeQuotes(inner)
        }
    }
    return unescapeQuotes(trimmed)
}

function unescapeQuotes(s: string): string {
    // first replace escaped backslashes, then escaped quotes
    return s
    // remove escaped newlines (line continuation)
    .replace(/\\\n/g, '')
    .replace(/\\\\/g, '\\')
    .replace(/\\ /g, ' ')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
}
