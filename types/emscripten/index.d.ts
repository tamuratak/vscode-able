/// <reference types="emscripten" />
export type FS = typeof FS & {
    filesystems: {
        IDBFS: Emscripten.FileSystemType | undefined
        MEMFS: Emscripten.FileSystemType
        NATIVEFS_ASYNC: Emscripten.FileSystemType | undefined
        NODEFS: Emscripten.FileSystemType | undefined
        PROXYFS: Emscripten.FileSystemType | undefined
        WORKERFS: Emscripten.FileSystemType | undefined
    },
    mkdirTree: (path: string, mode?: number) => FSNode
}
