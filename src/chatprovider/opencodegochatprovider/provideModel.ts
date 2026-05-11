import { CancellationToken, LanguageModelChatInformation } from 'vscode';
import { getBuiltInModelInfos } from './models.js';

/**
 * Get the list of available language models contributed by this provider.
 */
export function prepareLanguageModelChatInformation(
    _options: { silent: boolean },
    _token: CancellationToken
): LanguageModelChatInformation[] {
    const infos = getBuiltInModelInfos();
    return infos;
}
