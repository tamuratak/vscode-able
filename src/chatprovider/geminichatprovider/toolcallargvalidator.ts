import * as vscode from 'vscode'
import Ajv from 'ajv'
import { ValidateFunction } from 'ajv'

const toolCallValidatorMap = new Map<string, ValidateFunction<unknown>>()
const toolCallAjv = new Ajv({coerceTypes: true})

export function initValidators(tools: readonly vscode.LanguageModelChatTool[] | undefined) {
    for (const tool of tools ?? []) {
        if (tool.inputSchema && !toolCallValidatorMap.has(tool.name)) {
            toolCallValidatorMap.set(tool.name, toolCallAjv.compile(tool.inputSchema))
        }
    }
}

export function getValidator(name: string): ValidateFunction<unknown> | undefined {
    return toolCallValidatorMap.get(name)
}
