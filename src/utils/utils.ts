export function deepEqual(obj1: unknown, obj2: unknown): boolean {
    const stack: [unknown, unknown][] = [[obj1, obj2]]
    while (stack.length > 0) {
        const [a, b] = stack.pop()!
        if (a === b) {
            continue
        }
        if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
            return false
        }
        const keysA = Object.keys(a)
        const keysB = Object.keys(b)
        if (keysA.length !== keysB.length) {
            return false
        }
        for (const key of keysA) {
            if (!(key in b)) {
                return false
            }
            stack.push([(a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]])
        }
    }
    return true
}
