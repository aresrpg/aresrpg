// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'

import { expect, test, type Page } from '@playwright/test'

const OUT = process.env.ARES_TEST_OUT ?? new URL('../test-results/out/lane68', import.meta.url).pathname

test.use({ headless: false, viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' })

const state = (page: Page) => page.evaluate(() => (window as any).__ARES_DEV_STATE?.() ?? null)

test('lane68: an executed failure latches the same-turn auto-fire', async ({ page }) => {
  test.setTimeout(240_000)
  fs.mkdirSync(OUT, { recursive: true })
  await page.addInitScript(() => {
    localStorage.setItem('ares_tutorial_seen_v2', '1')
    ;(window as any).__ARES_FIGHT_TRACE_ENABLED = true
    ;(window as any).__ARES_DEV_SYNTH_DEADLINE_MS = 2_500
    ;(window as any).__ARES_DEV_FAIL_TURN_COMMIT = true
  })
  await page.goto('/game-world?dev&fighttrace=1', { waitUntil: 'domcontentloaded' })
  await expect
    .poll(
      () =>
        page
          .evaluate(
            () =>
              typeof (window as any).__ARES_DEV_SYNTH_FIGHT === 'function' &&
              typeof (window as any).__ARES_DEV_CELL_SCREEN === 'function' &&
              !!(window as any).__voxel_ctl?.get_transform?.()
          )
          .catch(() => false),
      { timeout: 180_000, intervals: [2_000] }
    )
    .toBe(true)
  const mounted = await page.evaluate(() => (window as any).__ARES_DEV_SYNTH_FIGHT())
  expect(mounted?.ok, JSON.stringify(mounted)).toBe(true)
  await expect
    .poll(() => page.evaluate(() => !!(window as any).__voxel_board?._descriptor?.()).catch(() => false), {
      timeout: 60_000,
      intervals: [1_000],
    })
    .toBe(true)
  await page.waitForTimeout(1_500)

  const draft_once = async () => {
    const current = await state(page)
    const origin = current?.my_cell
    expect(origin).toBeTruthy()
    for (const cell of [
      [origin.x + 1, origin.y],
      [origin.x - 1, origin.y],
      [origin.x, origin.y + 1],
      [origin.x, origin.y - 1],
    ]) {
      const screen = await page.evaluate(([x, y]) => (window as any).__ARES_DEV_CELL_SCREEN?.(x, y) ?? null, cell)
      if (!screen) continue
      await page.mouse.click(screen.x, screen.y)
      const drafted = await expect
        .poll(async () => (await state(page))?.move_path ?? 0, { timeout: 2_000, intervals: [100] })
        .toBeGreaterThan(0)
        .then(() => true)
        .catch(() => false)
      if (drafted) return true
    }
    return false
  }

  expect(await draft_once()).toBe(true)
  await expect
    .poll(() => page.evaluate(() => (window as any).__ARES_DEV_FAIL_TURN_COMMIT_COUNT ?? 0), {
      timeout: 15_000,
      intervals: [200],
    })
    .toBe(1)
  await page.screenshot({ path: `${OUT}/postfix_1_executed_failure.png` })

  expect(await draft_once()).toBe(true)
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          ((window as any).__ARES_FIGHT_TRACE ?? []).some((row: any) => row.event === 'auto_flush_latched')
        ),
      {
        timeout: 15_000,
        intervals: [200],
      }
    )
    .toBe(true)
  expect(await page.evaluate(() => (window as any).__ARES_DEV_FAIL_TURN_COMMIT_COUNT ?? 0)).toBe(1)
  const trace = await page.evaluate(() => (window as any).__ARES_FIGHT_TRACE ?? [])
  fs.writeFileSync(`${OUT}/postfix_transition_trace.json`, `${JSON.stringify(trace, null, 2)}\n`)
  await page.screenshot({ path: `${OUT}/postfix_2_same_turn_latched.png` })
})
