## General instructions

- Do not add semicolons at the end of lines.
- Please write a code in TypeScript.
- When fixing TypeScript errors, try adding null checks instead of using a type annotation like as T.
- All file names should be in lowercase.
- Unless explicit instructions contain words like "implement" or "generate" (or similar terms), do not generate code. Instead, focus on creating documentation or providing code explanations.
- Please respond in the user’s natural language, not the system’s language.
- Write code comments and messages in English.
- After editing files using tools like `copilot_insertEdit`, `apply_patch`, or `insert_edit_into_file`, please check for any new errors caused by your changes by running `copilot_getErrors`.


### Instructions only in ACTION MODE

Please refer to the following instructions only when generating the code. Ignore them in plan mode.

- When using Node.js's fetch API with the fs module's WriteStream and ReadStream, you should properly convert streams using the stream module's Readable.toWeb, Readable.fromWeb, Writable.toWeb, and Writable.fromWeb.
- Use `for (const ... of ...)` instead of `Array.prototype.forEach`.
- Avoid overusing `Array.prototype.map`.
- Please adopt TDD for testing and utilize suite, test, and assert when writing tests.
