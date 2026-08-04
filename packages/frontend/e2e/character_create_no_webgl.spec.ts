// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2198 — the GPU-LESS front door, driven in a real browser. Every webgl/webgl2 context request is
// answered `null` before any app code runs (`addInitScript`), which is exactly what Chrome does with
// hardware acceleration disabled — the cohort whose console the Discord report came from (Sentry
// ARESRPG-APP-3G). Drives the REAL character_create() screen through the standalone harness
// (character-create-harness.html — same module, same CSS, no chain/auth/roster).
//
// RED on the unedited tree: the WebGLRenderer constructor throws out of character_pedestal(), the
// harness module dies, and NOTHING renders — no panel, a page error. GREEN: the static class
// portrait, the honest notice, and a create button that arms on a valid name.
//
//   bunx playwright test e2e/character_create_no_webgl.spec.ts   (from packages/frontend)
import { test, expect } from '@playwright/test'

const KILL_WEBGL = `
  const real = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    if (String(kind).startsWith('webgl') || String(kind).startsWith('experimental-webgl')) return null
    return real.call(this, kind, ...rest)
  }
`

test('a dead WebGL context degrades the creator to a static portrait and never blocks creation', async ({ page }) => {
  const page_errors: string[] = []
  page.on('pageerror', (error) => page_errors.push(error.message))
  await page.addInitScript(KILL_WEBGL)

  await page.goto('/character-create-harness.html?placement=inline', { waitUntil: 'load' })
  await page.waitForSelector('.cc__panel', { timeout: 15_000 })

  // ① the failure never escapes — no uncaught error killed the screen.
  expect(page_errors).toEqual([])

  // ② the stage shows the static class portrait, not a blank hole and not the "model soon" lie.
  await expect(page.locator('[data-portrait]')).toBeVisible()
  await expect(page.locator('[data-soon]')).toBeHidden()
  await expect(page.locator('[data-rot]')).toBeHidden()
  await expect(page.locator('[data-flatnote]')).toBeVisible()

  // ③ the flow stays completable: every control lives, and a valid name arms Create.
  const create = page.locator('[data-create]')
  await expect(create).toBeDisabled()
  await page.locator('[data-name]').fill('Gpuless')
  await expect(create).toBeEnabled()
  await create.click()
  await expect(create).toHaveAttribute('aria-busy', 'true') // the mint actually fired
  expect(page_errors).toEqual([])
})
