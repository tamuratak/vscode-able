---
description: How to use the able_playwrightExec and able_playwrightExecReset tools
---

## Purpose

Use `able_playwrightExec` to run JavaScript against a persistent Playwright session.
Use `able_playwrightExecReset` to discard that session and start clean.

## When To Use

- Use `able_playwrightExec` for local browser inspection, DOM interaction, and screenshots
- Use `able_playwrightExec` again when you want to reuse the same page, cookies, and session state
- Use `able_playwrightExecReset` when the session is contaminated, stuck, or must return to a clean state

## Execution Model

- JavaScript runs with top level `await`
- Session state persists across `able_playwrightExec` calls in the same chat session
- Local variables declared inside one execution do not persist into the next execution
- After `able_playwrightExecReset`, the next run starts from a fresh session
- Available globals are `pwApi`, `console`, `setTimeout`, `clearTimeout`, and `URL`

## pwApi Interface

```ts
import type { Page } from 'playwright'

type ImageFormat = 'jpeg' | 'png'
type ScreenshotClip = { x: number, y: number, width: number, height: number }

interface ScreenshotOptions {
  format?: ImageFormat
  quality?: number
  fullPage?: boolean
  clip?: ScreenshotClip
}

interface ScreenshotMeta {
  width: number
  height: number
  cssWidth: number
  cssHeight: number
  deviceScaleFactor: number
  clipped: boolean
  clipRect?: ScreenshotClip
}

interface ScreenshotResult {
  text: string
  meta: ScreenshotMeta
}

interface PwApi {
  page: Page
  screenshot(options?: ScreenshotOptions): Promise<ScreenshotResult>
}
```

`pwApi.page` is the native Playwright `Page` object. Use Playwright methods directly, such as `goto`, `locator`, `click`, `fill`, `textContent`, and `evaluate`.

`pwApi.screenshot(options?)` captures the current page. Default format is `jpeg`, `quality` applies to `jpeg`, `clip` uses CSS pixels, and the tool response includes an image output part.

Do not assume extra helpers like `pwApi.fill` exist.

## Network And Safety Constraints

- Only `http:` and `https:` are allowed
- Only loopback hosts are allowed: `localhost`, `127.0.0.1`, `::1`, `[::1]`
- The port must be explicit and must be between `3000` and `3010`
- External sites should be treated as blocked
- Execution timeout is about 15 seconds per call
- `stdout` and `stderr` are truncated
- At most 3 screenshots are allowed per execution

Allowed examples:

- `http://localhost:3000`
- `https://127.0.0.1:3001/path`

Blocked examples:

- `https://example.com`
- `http://localhost`
- `http://localhost:8080`

## Examples

```ts
await pwApi.page.goto('http://localhost:3000')
return await pwApi.page.textContent('#title')
```

```ts
await pwApi.page.goto('http://localhost:3000')
await pwApi.page.fill('#name', 'Updated by Agent')
await pwApi.page.click('#apply')
return await pwApi.page.textContent('#title')
```

```ts
await pwApi.page.goto('http://localhost:3000')
await pwApi.screenshot({ format: 'png', fullPage: true })
return 'captured'
```

After `able_playwrightExecReset`, a fresh session typically starts from:

```ts
return pwApi.page.url()
```

Expected result: `about:blank`

## Guidance For LLM Agents

- Prefer short, deterministic snippets
- Reuse `pwApi.page` instead of narrating browser state in text
- Check loopback and port restrictions first when navigation fails
- Call `able_playwrightExecReset` before retrying if state looks unreliable
