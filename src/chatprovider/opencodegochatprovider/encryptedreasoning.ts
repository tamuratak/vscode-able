import { LanguageModelDataPart, LanguageModelResponsePart2, LanguageModelThinkingPart } from 'vscode'

/**
 * Contract for round-tripping encrypted reasoning content across user turns.
 *
 * VS Code's built-in Copilot agent does not resend thinking parts of previous
 * turns when calling a third-party language model provider (the prompt builder
 * only includes thinking for the current turn unless the endpoint advertises
 * historical thinking support). The only response part Copilot persists across
 * turns and replays as a data part is the stateful marker (`stateful_marker`
 * mime type, `modelId\marker` payload), which it stores on the tool-call round
 * and carries over into later requests.
 *
 * This provider therefore emits the encrypted reasoning content as such a
 * marker data part, using a marker prefix that identifies it as ours, and
 * converts markers found in incoming assistant messages back into reasoning
 * input items.
 *
 * Scope: the marker channel is only needed for the classic Copilot chat flow.
 * In the agent host (BYOK) flow the conversation is carried by reasoning
 * items, whose encrypted content arrives via thinking part metadata instead.
 * The agent host captures any stateful marker as a response-id marker, so our
 * marker may be captured there as well; it is replayed back as a stateful
 * marker and deduplicated by convertMessages, so it is harmless but
 * redundant.
 */
export const statefulMarkerMimeType = 'stateful_marker'

/** Marker prefix distinguishing our encrypted reasoning from Copilot's own response-id markers. */
const encryptedReasoningMarkerPrefix = 'able-enc:'

export interface EncryptedReasoningData {
	id: string
	content: string
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

function isEncryptedReasoningData(value: unknown): value is EncryptedReasoningData {
	if (typeof value !== 'object' || value === null) {
		return false
	}
	if (!('id' in value) || !('content' in value)) {
		return false
	}
	return typeof value['id'] === 'string' && typeof value['content'] === 'string'
}

/**
 * Encode the marker payload. Base64url never contains the backslash that
 * separates modelId and marker in the stateful marker format.
 */
function encodeMarker(data: EncryptedReasoningData): string {
	return encryptedReasoningMarkerPrefix + Buffer.from(JSON.stringify(data)).toString('base64url')
}

function decodeMarker(marker: string): EncryptedReasoningData | undefined {
	if (!marker.startsWith(encryptedReasoningMarkerPrefix)) {
		return undefined
	}
	try {
		const parsed: unknown = JSON.parse(
			Buffer.from(marker.slice(encryptedReasoningMarkerPrefix.length), 'base64url').toString('utf8')
		)
		return isEncryptedReasoningData(parsed) ? parsed : undefined
	} catch {
		return undefined
	}
}

/**
 * Encode a stateful marker data part carrying our encrypted reasoning payload,
 * matching Copilot's `modelId\marker` wire format.
 */
export function encodeEncryptedReasoningPart(modelId: string, data: EncryptedReasoningData): LanguageModelDataPart {
	return new LanguageModelDataPart(textEncoder.encode(modelId + '\\' + encodeMarker(data)), statefulMarkerMimeType)
}

/**
 * Decode a stateful marker data part into our encrypted reasoning payload, or
 * undefined when the part is not one of ours (e.g. Copilot's own response-id
 * markers) or was emitted by a different model.
 */
export function decodeEncryptedReasoningPart(part: LanguageModelDataPart, expectedModelId: string): EncryptedReasoningData | undefined {
	if (part.mimeType !== statefulMarkerMimeType) {
		return undefined
	}
	const decoded = textDecoder.decode(part.data)
	const separatorIndex = decoded.indexOf('\\')
	// The model id before the separator must match the current model: markers
	// of a previous model carry encrypted content that cannot be decrypted.
	if (separatorIndex === -1 || decoded.slice(0, separatorIndex) !== expectedModelId) {
		return undefined
	}
	return decodeMarker(decoded.slice(separatorIndex + 1))
}

/**
 * Build the response parts that carry encrypted reasoning content to the chat
 * agent: a thinking part holding the encrypted content in metadata, and a
 * stateful marker data part so the content round-trips into later user turns.
 * The marker is only emitted when the reasoning item has an id to replay.
 */
export function createEncryptedReasoningParts(
	modelId: string,
	data: EncryptedReasoningData,
	value: string
): LanguageModelResponsePart2[] {
	const parts: LanguageModelResponsePart2[] = [
		new LanguageModelThinkingPart(value, data.id || undefined, { encrypted_content: data.content }),
	]
	if (data.id) {
		parts.push(encodeEncryptedReasoningPart(modelId, data))
	}
	return parts
}
