
export function convertMathEnv(text: string) {
    return text
        .replace(/\\begin{(align|equation)\*?}/g, '$$')
        .replace(/\\end{(align|equation)\*?}/g, '$$')
}
