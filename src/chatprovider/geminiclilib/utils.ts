export interface Attachment {
    content: string,
    id: string | undefined,
    filePath: string | undefined,
    isSummarized?: string | undefined
}

const attachmentsBlockRegex = /^<attachments>$([\s\S]*?)^<\/attachments>$/m
const attachmentTagPattern = /^<attachment\b([^>]*)>$([\s\S]*?)^<\/attachment>$/gm
const reminderInstructionsRegex = /^<reminderInstructions>$[\s\S]*?^<\/reminderInstructions>$/gm
const attributePattern = /(\w+)="([^"]*)"/g

export function tweakUserPrompt(input: string) {
    const { newInput, attachments } = extractAttachments(input)
    const withoutAttachments = newInput.replace(attachmentsBlockRegex, '')
    const userPrompt = withoutAttachments.replace(/^<user>\s*/i, '').replace(/\s*<\/user>$/i, '').replace(reminderInstructionsRegex, '').trim()
    return { userPrompt, attachments }
}

export function extractAttachments(input: string) {
    const newInput = input.replace(attachmentsBlockRegex, '')
    const attachments: Attachment[] = []
    const attachmentsBlockMatch = input.match(attachmentsBlockRegex)
    if (attachmentsBlockMatch) {
        const attachmentsBlock = attachmentsBlockMatch[1]
        let attachmentTagMatch: RegExpExecArray | null
        attachmentTagPattern.lastIndex = 0
        while ((attachmentTagMatch = attachmentTagPattern.exec(attachmentsBlock)) !== null) {
            const attributeSource = attachmentTagMatch[1]
            const attributes: Record<string, string> = {}
            attributePattern.lastIndex = 0
            let attributeMatch: RegExpExecArray | null
            while ((attributeMatch = attributePattern.exec(attributeSource)) !== null) {
                attributes[attributeMatch[1]] = attributeMatch[2]
            }
            attachments.push({ content: attachmentTagMatch[2].trim(), id: attributes['id'], filePath: attributes['filePath'], isSummarized: attributes['isSummarized'] })
        }
    }
    return { newInput, attachments }
}

export function replaceInstsInSystemPrompt(input: string) {
    const agentInstructionsRegex = /^<instructions>[\s\S]*?You are a highly sophisticated automated coding agent[\s\S]*?^<\/instructions>$/gm
    const agentInst = `<instructions>
You are a highly sophisticated automated coding agent with expert-level knowledge across many different programming languages and frameworks.
The user will ask a question, or ask you to perform a task, and it may require lots of research to answer correctly. There is a selection of tools that let you perform actions or retrieve helpful context to answer the user's question.
You will be given some context and attachments along with the user prompt. You can use them if they are relevant to the task, and ignore them if not.
If you can infer the project type (languages, frameworks, and libraries) from the user's query or the context that you have, make sure to keep them in mind when making changes.
If the user wants you to implement a feature and they have not specified the files to edit, first break down the user's request into smaller concepts and think about the kinds of files you need to grasp each concept.
You don't need to read a file if it's already provided in context.
</instructions>`
    let newInput = input.replace(/^<toolUseInstructions>$[\s\S]*?^<\/toolUseInstructions>$/gm, '').trim()
    newInput = newInput.replace(agentInstructionsRegex, agentInst).trim()
    return newInput.replace(/^<editFileInstructions>$[\s\S]*?^<\/editFileInstructions>$/gm, '').trim()
}
