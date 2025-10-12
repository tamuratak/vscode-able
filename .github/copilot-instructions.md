## General instructions

- Do not add semicolons at the end of lines.
- Please write a code in TypeScript.

- All file names should be in lowercase.
- All file names should not include hyphens, spaces, nor underscores.
- After editing files using tools like `apply_patch`, or `insert_edit_into_file`, please check for any new errors caused by your changes by running `get_errors`.
- After editing files, you don't have to run tests. But if you want, please run the `task-test` task using the `run_task` tool.


### Instructions only in ACTION MODE

Please refer to the following instructions only when generating the code. Ignore them in plan mode.

- When using Node.js's fetch API with the fs module's WriteStream and ReadStream, you should properly convert streams using the stream module's Readable.toWeb, Readable.fromWeb, Writable.toWeb, and Writable.fromWeb.
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
