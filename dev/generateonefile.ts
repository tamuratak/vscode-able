import { readFile } from 'node:fs/promises'
import * as path from 'node:path'

async function main() {
    const args = process.argv.slice(2)
    if (args.length < 1) {
        console.error('Usage: node generateonefile.js <inputfile1> [<inputfile2> ...]')
        process.exit(1)
    }
    const inputFiles = args

    for (const file of inputFiles) {
        try {
            const absFilePath = path.relative(process.cwd(), path.resolve(file))
            const data = await readFile(absFilePath, 'utf-8')
            const content = `### File: ${absFilePath}\n\nContent:\n${data}`
            console.log(content)
        } catch (error) {
            console.error(`Error reading file ${file}: ${error}`)
        }
    }
}

main()
