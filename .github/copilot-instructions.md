## General instructions

- Do not add semicolons at the end of lines.
- Please write a code in TypeScript.
- All file names should be in lowercase.
- Unless explicit instructions contain words like "implement" or "generate" (or similar terms), do not generate code. Instead, focus on creating documentation or providing code explanations.

### Instructions only in ACTION MODE

Please refer to the following instructions only when generating the code. Ignore them in plan mode.

- When using Node.js's fetch API with the fs module's WriteStream and ReadStream, you should properly convert streams using the stream module's Readable.toWeb, Readable.fromWeb, Writable.toWeb, and Writable.fromWeb.
- Use `for (const ... of ...)` instead of `Array.prototype.forEach`.
- Avoid overusing `Array.prototype.map`.
- Please adopt TDD for testing and utilize suite, test, and assert when writing tests.
