// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2205 — the simulator's BOARD PANE on a GPU-LESS device, driven in a real browser. Every webgl/webgl2
// context request is answered `null` before any app code runs (`addInitScript`) — exactly what Chrome does
// with hardware acceleration disabled, and what a blocklisted driver does on its own.
//
// Drives the REAL `SimulatorBoardPane` through the standalone harness (simulator-board-harness.html — same
// module, same store, same lazy engine mount, no chain/auth: the /simulator route itself sits behind the
// app's sign-in wall, which is not what this ticket is about).
//
// RED on the unedited tree (measured): the engine SURVIVES construction — it reports its own boot failure
// and hands back a renderer-less shell — and the first throw lands one paint later, inside the pane's bare
// `void viewport.show(board, scene)`: `board.build()` → `engine.add_to_scene`. Unhandled rejection, and the
// board region stays a dead black rectangle under a hint that still says "click a blue cell to place a
// character". GREEN: the honest "board unavailable" notice, no page error, read-out and verb still live.
//
//   bunx playwright test e2e/simulator_no_webgl.spec.ts   (from packages/frontend)
import { test, expect } from '@playwright/test'

const KILL_WEBGL = `
  const real = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    if (String(kind).startsWith('webgl') || String(kind).startsWith('experimental-webgl')) return null
    return real.call(this, kind, ...rest)
  }
`

test('a dead WebGL context degrades the simulator board and never kills the pane', async ({ page }) => {
  const page_errors: string[] = []
  page.on('pageerror', (error) => page_errors.push(error.message))
  await page.addInitScript(KILL_WEBGL)

  await page.goto('/simulator-board-harness.html', { waitUntil: 'load' })

  // ① the board region says what happened instead of a blank hole or the click-a-cell lie.
  await expect(page.locator('[data-board-unavailable]')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('3D BOARD UNAVAILABLE')).toBeVisible()
  await expect(page.getByText('Click a blue cell to place a character', { exact: false })).toHaveCount(0)

  // ② the pane is not a casualty of the renderer — its read-out and its verb are live and clickable.
  const reroll = page.getByRole('button', { name: /REROLL BOARD/i })
  await expect(reroll).toBeVisible()
  const before = await page
    .getByText(/ANCHOR/)
    .first()
    .innerText()
  await reroll.click()
  await expect(page.getByText(/ANCHOR/).first()).not.toHaveText(before) // the reroll really rerolled

  // ③ nothing escaped: no unhandled rejection, no uncaught error, before or after the interaction.
  expect(page_errors).toEqual([])
})
