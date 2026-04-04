import { chromium } from 'playwright'

export const browserPromise = chromium.launch({ headless: true })
