import { LanguageModelPromptTsxPart } from 'vscode'
import { renderElementJSON } from '@vscode/prompt-tsx'


/**
 * Creates a `LanguageModelPromptTsxPart` from the result returned by `renderElementJSON`.
 * A helper function to ease the inconvenience caused by the LanguageModelPromptTsxPart constructor's argument having an unknown type.
 */
export function createLanguageModelPromptTsxPart(
    input: Awaited<ReturnType<typeof renderElementJSON>>
) {
    return new LanguageModelPromptTsxPart(input)
}
