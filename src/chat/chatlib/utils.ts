/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return */
import * as vscode from 'vscode'
import { AbleChatResultMetadata } from '../chat.js';


export function isAbleChatResultMetadata(metadata: any): metadata is AbleChatResultMetadata {
    return metadata && typeof metadata.input === 'string' && typeof metadata.output === 'string' &&
        metadata.selected && typeof metadata.selected.text === 'string' &&
        metadata.selected.uri instanceof vscode.Uri && metadata.selected.range instanceof vscode.Range &&
        (metadata.userInstruction === undefined || typeof metadata.userInstruction === 'string');
}
