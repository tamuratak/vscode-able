## General instructions

- Do not add semicolons at the end of lines.
- Please write a code in TypeScript.

- All file names should be in lowercase.
- All file names should not include hyphens, spaces, nor underscores.
- Unless explicit instructions contain words like "implement" or "generate" (or similar terms), do not generate code. Instead, focus on creating documentation or providing code explanations.
- After editing files using tools like `copilot_insertEdit`, `apply_patch`, or `insert_edit_into_file`, please check for any new errors caused by your changes by running `copilot_getErrors`.


### Instructions only in ACTION MODE

Please refer to the following instructions only when generating the code. Ignore them in plan mode.

- When using Node.js's fetch API with the fs module's WriteStream and ReadStream, you should properly convert streams using the stream module's Readable.toWeb, Readable.fromWeb, Writable.toWeb, and Writable.fromWeb.
- Use `for (const ... of ...)` instead of `Array.prototype.forEach`.
- Avoid overusing `Array.prototype.map`.
- Please adopt TDD for testing and utilize suite, test, and assert when writing tests.
- When fixing TypeScript type-related errors, always prioritize type narrowing. Avoid type assertions unless absolutely necessary.
- Never use property-shape checks (e.g. checking r['value'], 'value' in r, or typeof r.value) for type narrowing.
- Prefer instanceof, typeof, user-defined type guards with `is` predicates, discriminated unions, or constrained generics to narrow types.
- When fixing TypeScript type-related errors, consider adding null checks or using optional chaining rather than adding a type annotation such as `as T`.
- Use undefined instead of null for optional properties.
- Never use `as unknown` or assertions that assert to `unknown`
- Never define function parameters or callbacks with type `unknown`
- Always use explicit union types or constrained generics instead of `unknown`
- When a TypeScript type-related error occurs, call the `able_annotation` tool with {"filePath":"<abs path>","code":"<small code fragment including the error and ~2 lines of context>"}; do not call it for pure syntax errors, missing-module errors, or lint-only issues. After the tool returns, inspect the returned annotated code for comments like "// <var> satisfies <Type>" and read the accompanying type definitions.
- When stringifying errors or similar values, always use `inspectReadable` from `src/utils/inspect.ts`.
