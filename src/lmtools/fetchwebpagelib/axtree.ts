/// <reference lib="dom" />
import { Browser } from 'playwright'

export interface GetAXOptions {
    waitForMs?: number
    waitForSelector?: string | undefined
    waitForStableMs?: number
    networkIdleMs?: number
    timeoutMs?: number
}

// Contract: returns raw result from Accessibility.getFullAXTree
export async function getFullAXTree(browser: Browser, urlOrPath: string, options: GetAXOptions = {}) {
    const {
        waitForMs = 1000,
        waitForSelector,
        waitForStableMs = 500,
        networkIdleMs = 500,
        timeoutMs = 30000
    } = options

    const context = await browser.newContext()
    const page = await context.newPage()
    const isFile = urlOrPath.startsWith('file:') || /^[./\\]/.test(urlOrPath)
    const target = isFile && !urlOrPath.startsWith('file:') ? `file://${urlOrPath}` : urlOrPath

    const gotoOptions: { waitUntil: 'domcontentloaded' | 'load' | 'networkidle' | 'commit'; timeout?: number } = { waitUntil: 'domcontentloaded', timeout: timeoutMs }
    await page.goto(target, gotoOptions)

    // wait for fonts if available
    try {
        await page.evaluate(() => {
            // Some environments may expose document.fonts.ready
            interface FontsLike { ready?: Promise<void> }
            const d = document as Document & { fonts?: FontsLike }
            if (d.fonts && typeof d.fonts.ready !== 'undefined') {
                return d.fonts.ready as Promise<void>
            }
            return Promise.resolve()
        })
    } catch {
        // ignore
    }

    if (waitForSelector) {
        await page.waitForSelector(waitForSelector, { timeout: timeoutMs })
    }

    // network idle attempt
    try {
        await page.waitForLoadState('networkidle', { timeout: networkIdleMs })
    } catch {
        // ignore network idle failures
    }

    // DOM stable using mutation observer injected into page
    if (waitForStableMs > 0) {
        await page.evaluate(({ stableMs, maxWait }: { stableMs: number; maxWait: number }) => {
            return new Promise<void>((resolve) => {
                const start = Date.now()
                let last = Date.now()
                const observer = new MutationObserver(() => {
                    last = Date.now()
                })
                observer.observe(document, { attributes: true, childList: true, subtree: true })

                const check = () => {
                    if (Date.now() - last >= stableMs) {
                        observer.disconnect()
                        resolve()
                        return
                    }
                    if (Date.now() - start > maxWait) {
                        observer.disconnect()
                        resolve()
                        return
                    }
                    setTimeout(check, 50)
                }
                check()
            })
        }, { stableMs: waitForStableMs, maxWait: timeoutMs })
    }

    if (waitForMs > 0) {
        await page.waitForTimeout(waitForMs)
    }

    const session = await context.newCDPSession(page)
    const result = await session.send('Accessibility.getFullAXTree')
    return result
}
