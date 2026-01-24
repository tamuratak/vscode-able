export interface AttachmentInfo {
    id: string
    filePath: string
    content: string
}

const attachmentsBlockRegex = /<attachments>([\s\S]*?)<\/attachments>/
const attachmentTagPattern = /<attachment\b([^>]*)>([\s\S]*?)<\/attachment>/gi
const attributePattern = /(\w+)="([^"]*)"/g

export function tweakUserPrompt(input: string) {
    const { newInput, attachments } = extractAttachments(input)
    const withoutAttachments = newInput.replace(attachmentsBlockRegex, '')
    const userPrompt = withoutAttachments.replace(/^<user>\s*/i, '').replace(/\s*<\/user>$/i, '').trim()
    return { userPrompt, attachments }
}

export function extractAttachments(input: string) {
    const withoutAttachments = input.replace(attachmentsBlockRegex, '')
    const newInput = withoutAttachments.replace(/^<user>\s*/i, '').replace(/\s*<\/user>$/i, '').trim()
    const attachments: { content: string, id: string, filePath: string, isSummarized: string }[] = []
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
