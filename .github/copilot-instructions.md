## General instructions

- Do not add semicolons at the end of lines.
- Please write a code in TypeScript.

- All file names should be in lowercase.
- All file names should not include hyphens, spaces, nor underscores.
- After editing files, you don't have to run tests. But if you want, please run the `task-test-json` task using the `run_task` tool. Don't run `npm run test` directly.
- When calling the `get_errors` tool, specify an empty array for `filePaths` to always retrieve all errors.
- We use Mocha's TDD interface as the test framework. `suite`, `test`, `setup`, `teardown` can be used for defining tests.
- We use `node:assert` for assertions in tests.

### Instructions only in ACTION MODE

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
