import * as vscode from 'vscode'
import Ajv from 'ajv'

type Cb = (obj: unknown) => boolean

const toolCallValidatorMap = new Map<string, Cb>()
const toolCallAjv = new Ajv()

export function initValidators(tools: vscode.LanguageModelChatTool[] | undefined) {
    for (const tool of tools ?? []) {
        if (tool.inputSchema) {
            toolCallValidatorMap.set(tool.name, toolCallAjv.compile(tool.inputSchema))
        }
    }
}

export function getValidator(name: string): Cb | undefined {
    return toolCallValidatorMap.get(name)
}
