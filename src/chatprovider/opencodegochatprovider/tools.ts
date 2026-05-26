// import * as vscode from 'vscode'
import { ProvideLanguageModelChatResponseOptions } from 'vscode'


export function tweakTools(options: ProvideLanguageModelChatResponseOptions) {
    const { tools } = options

    const toolsToRemove = ['session_store_sql']
    const newTools = tools?.filter(tool => !toolsToRemove.includes(tool.name)) ?? []

    return { ...options, tools: newTools }

}
