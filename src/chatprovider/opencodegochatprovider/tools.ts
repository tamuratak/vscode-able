// import * as vscode from 'vscode'
import { ProvideLanguageModelChatResponseOptions } from 'vscode'


export function tweakTools(options: ProvideLanguageModelChatResponseOptions) {
    const { tools } = options

    // https://github.com/microsoft/vscode/blob/4b04bed81a929b4603b508ce4a21993ae5fee2af/extensions/copilot/package.json#L1234
    const toolsToRemove = ['session_store_sql']
    const newTools = tools?.filter(tool => !toolsToRemove.includes(tool.name)) ?? []

    return { ...options, tools: newTools }

}
