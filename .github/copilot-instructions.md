## General instructions

- Do not add semicolons at the end of lines.
- Please write a code in TypeScript.

- All file names should be in lowercase.
- All file names should not include hyphens, spaces, nor underscores.

## Instructions for implementation

- After editing files, you don't have to run build. You can assume that the build will be run after you finish editing files automatically.
- After editing files, you don't have to run tests. You can assume that the tests will be run after you finish editing files automatically. 
- After editing files, using the `get_errors` tool, check if there are any errors in the codebase. If there are errors, please fix them before finishing the implementation.
- When calling the `get_errors` tool, specify `['/Users/tamura/src/github/vscode-able']` for `filePaths` to always retrieve all errors.
- The user is responsible for running tests with Playwright and VS Code runtime under the `./test/vscodeunittest` directory. Do not run the tests yourself. Instead, use `vscode_askQuestions` to ask the user for the test results. If errors are reported, analyze the results, propose a fix, and then ask the user to run the tests again. Repeat this cycle of asking for results and applying corrections until no errors remain.
- Once implementation is complete, use the `vscode_askQuestions` tool to ask the user if they want the agent to continue implementing, and repeat this process until they say no.

### Instructions for testing

- We use Mocha's TDD interface as the test framework. `suite`, `test`, `setup`, `teardown` can be used for defining tests.
- We use `node:assert` for assertions in tests.

### Instructions only in code generation mode

Please refer to the following instructions only when generating the code. Ignore them in plan mode.

- Use `for (const ... of ...)` instead of `Array.prototype.forEach`.
- Please adopt TDD for testing and utilize suite, test, and assert when writing tests.
- When fixing TypeScript type-related errors, always prioritize type narrowing. Avoid type assertions unless absolutely necessary.
- Never use property-shape checks (e.g. checking r['value'], 'value' in r, or typeof r.value) for type narrowing.
- Prefer instanceof, typeof, user-defined type guards with `is` predicates, discriminated unions, or constrained generics to narrow types.
- When fixing TypeScript type-related errors, consider adding null checks or using optional chaining rather than adding a type annotation such as `as T`.
- Use undefined instead of null for optional properties.
- Never use `as unknown` or assertions that assert to `unknown`
- Never define function parameters or callbacks with type `unknown`
- Always use explicit union types or constrained generics instead of `unknown`

- Always respond in Japanese in the chat. Write comments inside code in English.
- Use tools like nl or cat -n to display the contents of a file with line numbers.
- Avoid abbreviations such as DTO; when first introduced, spell them out as Data Transfer Object (DTO).

## When using the `apply_patch` tool

- When using the `apply_patch` tool, please note that `Delete File` is not supported.
- When replacing the whole content of a file, don't use the `apply_patch` tool. Use the `cat` command directly instead of the `apply_patch` tool.
