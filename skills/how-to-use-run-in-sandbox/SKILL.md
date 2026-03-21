---
name: how-to-use-run-in-sandbox
description: How to use the able_runInSandbox tool
---

## Purpose

Use `able_run_in_sandbox` to execute terminal commands in the workspace when you need concrete outputs, file inspection, or command-driven validation.

## Core Constraints

Before running commands, always remember:

- No network access is available
- Package installation is not possible (for example `npm install` will not work)
- There is no option to launch background processes
- Commands that run `vscode-test`, `electron`, or `playwright` often fail in the sandbox at execution time

## When to Ask the User Instead

If your workflow requires actions that cannot run inside the sandbox, ask the user through `vscode_askQuestions`.

Typical cases:

- Installing dependencies
- Starting long-running servers or watchers
- Running steps that need external network access

## Recommended Workflow

1. Decide whether the task can complete within sandbox limits
2. Run short, focused commands with `able_run_in_sandbox`
3. If blocked by sandbox limits, ask the user to perform the required step using `vscode_askQuestions`
4. Continue with follow-up commands after the user confirms completion

## Example Prompts to User

Use concise requests such as:

- "Please run dependency installation on your machine and tell me when it finishes"
- "Please start the development server and share the startup result"
- "This step needs network access. Please run it locally and paste the output"

## Practical Tips

- Prefer deterministic commands with explicit paths
- Keep command outputs focused by using filters such as `head`, `tail`, or `grep`
- Treat sandbox execution as foreground-only and finite-duration
