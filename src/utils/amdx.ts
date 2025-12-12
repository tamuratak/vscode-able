import Module from 'node:module'
import vm from 'node:vm'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

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
  ) {}
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

    const defineCall = await this._nodeLoadScript(scriptSrc)
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
    const script = new vm.Script(wrapped, { filename: normalizedPath })
    const compileWrapper = script.runInThisContext() as (...args: unknown[]) => unknown
    compileWrapper()
    return this._defineCalls.pop()
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
