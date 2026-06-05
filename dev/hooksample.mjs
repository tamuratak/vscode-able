#!/usr/bin/env node

import * as fs from 'fs'

process.stdin.setEncoding('utf8')

let content = ''

process.stdin.on('data', (chunk) => {
    content += chunk
});

process.stdin.on('end', () => {
    console.log(content)
    content += `cwd: ${process.cwd()}`
    fs.writeFileSync('/Users/tamura/src/github/vscode-able/hooksample_output.txt', content, 'utf8')
})
