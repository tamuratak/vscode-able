export interface Attachment {
    content: string,
    id: string | undefined,
    filePath: string | undefined,
    isSummarized?: string | undefined
}

const attachmentsBlockRegex = /^<attachments>([\s\S]*?)^<\/attachments>/m
const attachmentTagPattern = /^<attachment\b([^>]*)>([\s\S]*?)^<\/attachment>/gm
const attributePattern = /(\w+)="([^"]*)"/g

export function tweakUserPrompt(input: string) {
    const { newInput, attachments } = extractAttachments(input)
    const withoutAttachments = newInput.replace(attachmentsBlockRegex, '')
    const userPrompt = withoutAttachments.replace(/^<user>\s*/i, '').replace(/\s*<\/user>$/i, '').trim()
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
    const newInst = `<toolUseInstructions>
If the user is requesting a code sample, you can answer it directly without using any tools.
When using a tool, follow the JSON schema very carefully and make sure to include ALL required properties.
No need to ask permission before using a tool.
NEVER say the name of a tool to a user. For example, instead of saying that you'll use the run_in_terminal tool, say "I'll run the command in a terminal".
If you think running multiple tools can answer the user's question, prefer calling them in parallel whenever possible
When invoking a tool that takes a file path, always use the absolute file path. If the file has a scheme like untitled: or vscode-userdata:, then use a URI with the scheme.
You don't currently have any tools available for reading files.
You don't currently have any tools available for editing files. If the user asks you to edit a file, you can ask the user to enable editing tools or print a codeblock with the suggested changes.
You don't currently have any tools available for running terminal commands. If the user asks you to run a terminal command, you can ask the user to enable terminal tools or print a codeblock with the suggested command.
Tools can be disabled by the user. You may see tools used previously in the conversation that are not currently available. Be careful to only use the tools that are currently available to you.
</toolUseInstructions>`
    const newInput = input.replace(/<toolUseInstructions>[\s\S]*?<\/toolUseInstructions>/gi, newInst).trim()
    return newInput.replace(/<editFileInstructions>[\s\S]*?<\/editFileInstructions>/gi, '').trim()
}
