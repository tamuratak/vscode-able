const allowed = new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'application/pdf',
    'text/html',
    'application/json'
])
export function isSupportedMimeType(mimeType: string): boolean {
    const lower = mimeType.toLowerCase()
    const isAllowed = allowed.has(lower) || lower.endsWith('+json')
    return isAllowed
}
