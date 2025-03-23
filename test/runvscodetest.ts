import * as path from 'node:path'

import { runTests } from '@vscode/test-electron'

async function main() {
    try {
        // The folder containing the Extension Manifest package.json
        // Passed to `--extensionDevelopmentPath`
        const extensionDevelopmentPath = path.resolve(__dirname, '../../')

        // The path to the extension test runner script
        // Passed to --extensionTestsPath
        const extensionTestsPath = path.resolve(__dirname, './vscodeunittest.index')

        const fixuresDir = path.resolve(extensionDevelopmentPath, './test/fixtures')
        // Download VS Code, unzip it and run the integration test
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                fixuresDir,
                '--disable-extensions'
            ],
        })
    } catch (err) {
        console.error(err)
        console.error('Failed to run tests')
        process.exit(1)
    }
}

void main()
