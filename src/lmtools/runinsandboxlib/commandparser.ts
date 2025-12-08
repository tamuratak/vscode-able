export interface SimpleCommand {
    command: string
    args: string[]
}

export interface PipelineSequence {
    pipeline: SimpleCommand[]
}

export interface ParsedCommand {
    sequences: PipelineSequence[][]
}

export function parseCommand(command: string): ParsedCommand {
    const groups: PipelineSequence[][] = []
    let currentGroup: PipelineSequence[] = []
    let buffer = ''
    let inSingle = false
    let inDouble = false
    let index = 0

    while (index < command.length) {
        const char = command[index]
        const escaped = isEscaped(command, index)

        if (char === "'" && !inDouble && !escaped) {
            inSingle = !inSingle
            buffer += char
            index += 1
            continue
        } else if (char === '"' && !inSingle && !escaped) {
            inDouble = !inDouble
            buffer += char
            index += 1
            continue
        }

        // detect top-level operators: &&, ||, ;
        if (!inSingle && !inDouble && !escaped) {
            if (command.startsWith('&&', index) || command.startsWith('||', index)) {
                const part = buffer.trim()
                if (part.length > 0) {
                    const seq = parsePipeline(part)
                    if (seq !== null) {
                        currentGroup.push(seq)
                    }
                }
                buffer = ''
                index += 2
                continue
            }

            if (command[index] === ';') {
                const part = buffer.trim()
                if (part.length > 0) {
                    const seq = parsePipeline(part)
                    if (seq !== null) {
                        currentGroup.push(seq)
                    }
                }
                buffer = ''
                // finalize this semicolon-delimited group
                if (currentGroup.length > 0) {
                    groups.push(currentGroup)
                }
                currentGroup = []
                index += 1
                continue
            }
        }

        buffer += char
        index += 1
    }

    const tail = buffer.trim()
    if (tail.length > 0) {
        const seq = parsePipeline(tail)
        if (seq !== null) {
            currentGroup.push(seq)
        }
    }

    if (currentGroup.length > 0) {
        groups.push(currentGroup)
    }

    return { sequences: groups }
}

function parsePipeline(input: string): PipelineSequence | null {
    const parts = splitPipesTopLevel(input).map((p) => p.trim()).filter((p) => p.length > 0)
    const pipeline: SimpleCommand[] = []
    for (const part of parts) {
        const tokens = tokenizeSegment(part)
        if (tokens.length === 0) {
            continue
        }
        pipeline.push({ command: tokens[0], args: tokens.slice(1) })
    }
    if (pipeline.length === 0) {
        return null
    }
    return { pipeline }
}

function splitPipesTopLevel(input: string): string[] {
    const parts: string[] = []
    let buffer = ''
    let inSingle = false
    let inDouble = false
    let index = 0

    while (index < input.length) {
        const char = input[index]
        const escaped = isEscaped(input, index)

        if (char === "'" && !inDouble && !escaped) {
            inSingle = !inSingle
        } else if (char === '"' && !inSingle && !escaped) {
            inDouble = !inDouble
        }

        if (!inSingle && !inDouble && char === '|' && !escaped) {
            parts.push(buffer)
            buffer = ''
            index += 1
            continue
        }

        buffer += char
        index += 1
    }

    if (buffer.length > 0) {
        parts.push(buffer)
    }

    return parts
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
