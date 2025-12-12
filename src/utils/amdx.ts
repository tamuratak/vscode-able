/*

MIT License

Copyright (c) Microsoft Corporation. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

https://github.com/microsoft/vscode/blob/main/src/vs/amdX.ts

*/

import Module from 'node:module'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const nodeRequire = Module.createRequire(__filename)

type DefineFunction = ((id: string | null, dependencies: string[] | null, callback: unknown) => void) & {
    amd?: true
}

declare global {
    var define: DefineFunction | undefined
}

class DefineCall {
    constructor(
        public readonly id: string | null | undefined,
        public readonly dependencies: string[] | null | undefined,
        public readonly callback: unknown
    ) { }
}

enum AMDModuleImporterState {
    Uninitialized = 1,
    InitializedInternal,
    InitializedExternal
}

class AMDModuleImporter {
    public static readonly INSTANCE = new AMDModuleImporter()

    private readonly _defineCalls: DefineCall[] = []
    private _state = AMDModuleImporterState.Uninitialized
    private _previousDefine: DefineFunction | undefined = undefined

    private _initialize(): void {
        if (this._state !== AMDModuleImporterState.Uninitialized) {
            return
        }
        if (typeof globalThis.define === 'function' && globalThis.define.amd) {
            this._state = AMDModuleImporterState.InitializedExternal
            return
        }
        this._state = AMDModuleImporterState.InitializedInternal

        const defineFunction: DefineFunction = (id: string | null | undefined, dependencies: string[] | null | undefined, callback: unknown) => {
            let resolvedId: string | null | undefined = id
            let resolvedDependencies: string[] | null | undefined = dependencies
            let resolvedCallback = callback
            if (typeof resolvedId !== 'string') {
                resolvedCallback = resolvedDependencies
                resolvedDependencies = resolvedId as string[] | null | undefined
                resolvedId = null
            }
            if (!Array.isArray(resolvedDependencies)) {
                resolvedCallback = resolvedDependencies
                resolvedDependencies = null
            }
            this._defineCalls.push(new DefineCall(resolvedId, resolvedDependencies, resolvedCallback))
        }

        this._previousDefine = globalThis.define
        globalThis.define = defineFunction
        globalThis.define.amd = true
    }

    public async load<T>(scriptSrc: string): Promise<T> {
        this._initialize()

        if (this._state === AMDModuleImporterState.InitializedExternal) {
            const defineFn = globalThis.define
            if (!defineFn) {
                throw new Error('AMD define implementation disappeared')
            }
            return new Promise<T>(resolve => {
                const tmpModuleId = randomUUID()
                defineFn(tmpModuleId, [scriptSrc], (moduleResult: T) => {
                    resolve(moduleResult)
                })
            })
        }

        let defineCall: DefineCall | undefined
        try {
            defineCall = await this._nodeLoadScript(scriptSrc)
        } finally {
            this._restoreGlobalDefine()
        }
        if (!defineCall) {
            console.warn(`Did not receive a define call from script ${scriptSrc}`)
            return undefined as T
        }

        const exportsObj: Record<string, unknown> = {}
        const dependencyObjs: unknown[] = []
        const dependencyModules: string[] = []

        if (Array.isArray(defineCall.dependencies)) {
            for (const mod of defineCall.dependencies) {
                if (mod === 'exports') {
                    dependencyObjs.push(exportsObj)
                } else {
                    dependencyModules.push(mod)
                }
            }
        }

        if (dependencyModules.length > 0) {
            throw new Error(`Cannot resolve dependencies for script ${scriptSrc}. The dependencies are: ${dependencyModules.join(', ')}`)
        }

        const callback = defineCall.callback
        if (typeof callback === 'function') {
            const callbackFn = callback as (...args: unknown[]) => unknown
            return (callbackFn(...dependencyObjs) ?? exportsObj) as T
        }
        return callback as T
    }

    private _normalizeScriptPath(scriptSrc: string): string {
        if (scriptSrc.startsWith('file://')) {
            return fileURLToPath(scriptSrc)
        }
        return scriptSrc
    }

    private async _nodeLoadScript(scriptSrc: string): Promise<DefineCall | undefined> {
        const normalizedPath = this._normalizeScriptPath(scriptSrc)
        const content = await readFile(normalizedPath, 'utf8')
        const wrapped = Module.wrap(content.replace(/^#!.*/, ''))
        const compileWrapper = vm.runInThisContext(wrapped, {
            filename: normalizedPath,
            importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER
        }) as (...args: unknown[]) => unknown
        const exportsObj: Record<string, unknown> = {}
        const moduleObj = { exports: exportsObj }
        const scriptDir = path.dirname(normalizedPath)
        compileWrapper(exportsObj, nodeRequire, moduleObj, normalizedPath, scriptDir)
        return this._defineCalls.pop()
    }

    private _restoreGlobalDefine(): void {
        if (this._state !== AMDModuleImporterState.InitializedInternal) {
            return
        }
        globalThis.define = this._previousDefine
        this._previousDefine = undefined
        this._state = AMDModuleImporterState.Uninitialized
    }
}

// Reuse previous loads so repeated calls to the same AMD path do not re-run the script
const cache = new Map<string, Promise<unknown>>()

export async function importAMDNodeModule<T>(nodeModuleName: string, pathInsideNodeModule: string, isBuilt?: boolean): Promise<T> {
    const nodeModulePath = pathInsideNodeModule && pathInsideNodeModule.length > 0 ? `${nodeModuleName}/${pathInsideNodeModule}` : nodeModuleName
    const cacheKey = isBuilt ? `${nodeModulePath}?built` : nodeModulePath
    const cached = cache.get(cacheKey)
    if (cached) {
        return cached as Promise<T>
    }

    const scriptSrc = resolveAmdNodeModulePath(nodeModuleName, pathInsideNodeModule)
    const result = AMDModuleImporter.INSTANCE.load<T>(scriptSrc)
    cache.set(cacheKey, result)
    return result
}

export function resolveAmdNodeModulePath(nodeModuleName: string, pathInsideNodeModule: string): string {
    const moduleSpecifier = pathInsideNodeModule && pathInsideNodeModule.length > 0 ? `${nodeModuleName}/${pathInsideNodeModule}` : nodeModuleName
    return nodeRequire.resolve(moduleSpecifier)
}
