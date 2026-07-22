// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { devices, expect, test, webkit, type Page } from '@playwright/test'

const BASE_URL = `http://localhost:${Number(process.env.GOLD_PORT ?? 5490)}`

const rects = (page: Page) =>
  page.evaluate(() => {
    const viewport = window.visualViewport
    const host = document.querySelector('[data-testid="game-world-viewport"]')?.getBoundingClientRect()
    const canvas = document.querySelector('canvas.roam-canvas')?.getBoundingClientRect()
    const shape = (rect?: DOMRect) =>
      rect && {
        height: Math.round(rect.height),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
      }
    return {
      canvas: shape(canvas),
      host: shape(host),
      viewport: viewport && {
        height: Math.round(viewport.height),
        left: Math.round(viewport.offsetLeft),
        top: Math.round(viewport.offsetTop),
        width: Math.round(viewport.width),
      },
    }
  })

test('iPhone WebKit canvas follows the live visual viewport without safe-area gutters', async () => {
  const browser = await webkit.launch({ headless: true })
  const iphone = devices['iPhone 13 landscape']
  const context = await browser.newContext({
    baseURL: BASE_URL,
    viewport: { width: 844, height: 390 },
    screen: { width: 844, height: 390 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    userAgent: iphone.userAgent,
  })
  try {
    const page = await context.newPage()
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin === BASE_URL && url.pathname.startsWith('/v1/'))
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return route.continue()
      return route.abort()
    })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.evaluate(async () => {
      const [{ use_auth }, { use_spectate_gate }] = await Promise.all([
        import('/src/auth/index.ts'),
        import('/src/stores/spectate_gate.ts'),
      ])
      use_auth.setState({ address: null, is_loading: false })
      use_spectate_gate.getState().set_chosen(true)
    })
    await expect(page.locator('canvas.roam-canvas')).toBeVisible({ timeout: 90_000 })
    await expect
      .poll(() => rects(page))
      .toMatchObject({ canvas: { width: 844, height: 390 }, host: { width: 844, height: 390 } })

    await page.setViewportSize({ width: 780, height: 375 })
    await page.evaluate(() => window.visualViewport?.dispatchEvent(new Event('resize')))
    await expect
      .poll(() => rects(page))
      .toEqual({
        canvas: { height: 375, left: 0, top: 0, width: 780 },
        host: { height: 375, left: 0, top: 0, width: 780 },
        viewport: { height: 375, left: 0, top: 0, width: 780 },
      })
  } finally {
    await context.close()
    await browser.close()
  }
})

// LANE BORDER2 (the expected in-fight landscape signature: canvas CENTERED with SYMMETRIC
// ~safe-inset-wide gutters on both edges) — a real gold row simulating iOS excluding the safe-area from
// `visualViewport.width` (via an addInitScript defineProperty override, verified working in isolation:
// configurable getter, override applies before app boot) was ATTEMPTED but SKIPPED: two runs both timed
// out waiting for canvas.roam-canvas, and the webServer log showed concurrent HMR churn from unrelated
// lanes editing GameWorldHost.tsx/app.tsx/index.css live on this shared tree mid-run — not a defect in
// the fix. The regression oracle for this exact bug (a JS-API width-SOURCE selection, not a layout/paint
// defect) is the mechanism-pinned unit red/green in mobile_layout.test.jsx ('the game frame WIDTH sizes
// from the layout viewport, not the safe-area-excluded visualViewport'); this file's pre-existing row
// above still passes unmodified and continues to prove canvas/host/viewport tracking end-to-end.
