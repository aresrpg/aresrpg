// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { test, expect, type Page } from '@playwright/test'

// SESSION POSITION RESTORE — regression: refreshing the page did not restore the last on-foot position —
// proves the golden path against the REAL app: walk away from spawn, refresh, land back
// where you stood (not at the hardcoded WORLD_SPAWN / chain checkpoint). The world-shell spawns adapter owns
// the IndexedDB edge; boot awaits it, validates it against chain truth, then re-enters through `player_pos`.
//
// Reads the LIVE controller position via the DEV-only `window.__voxel_ctl` hook (embed_voxel_dev.js) — a
// direct, deterministic signal instead of screenshot heuristics, and the CURRENT hook now that
// roam.js/`__ARES_PLAYER` are gone post-D139 (the specs that kept driving the dead global were ported in #872).

const DEV_KEY = process.env.VITE_DEV_KEY ?? ''
const OUT = process.env.ARES_TEST_OUT ?? new URL('../test-results/out', import.meta.url).pathname

const ctl_position = (page: Page) =>
  page.evaluate(() => (window as any).__voxel_ctl?.get_transform?.()?.position as [number, number, number] | undefined)

async function wait_for_controller(page: Page, timeout = 60_000) {
  const t0 = Date.now()
  let pos = await ctl_position(page)
  while (!pos && Date.now() - t0 < timeout) {
    await page.waitForTimeout(500)
    pos = await ctl_position(page)
  }
  return pos
}

test('walking away from spawn then refreshing restores the live position (not WORLD_SPAWN)', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (e) => pageErrors.push(String(e?.stack || e)))

  await page.addInitScript((devKey: string) => {
    ;(window as any).__ARES_DEV_KEY = devKey
  }, DEV_KEY)

  await page.goto('/game-world?dev', { waitUntil: 'domcontentloaded' })

  // create-character fallback (the family's guard) — a confirmed-empty roster shows PLAY.
  const createAndPlay = page.locator('button:has-text("PLAY")')
  let needsCreate = false
  for (let i = 0; i < 15 && !needsCreate; i++) {
    needsCreate = await createAndPlay.isVisible().catch(() => false)
    if (!needsCreate) await page.waitForTimeout(3000)
  }
  if (needsCreate) {
    await page.getByPlaceholder('Enter name...').fill(`SPRSmoke${Date.now() % 100000}`)
    await createAndPlay.click()
    await expect(createAndPlay, 'character mint must clear the create screen').not.toBeVisible({ timeout: 40_000 })
  }

  const canvas = page.locator('canvas')
  await expect(canvas.first()).toBeVisible({ timeout: 60_000 })

  const before_walk = await wait_for_controller(page)
  expect(before_walk, 'the DEV rig must expose __voxel_ctl once the session boots').toBeTruthy()
  console.log('[session-position] boot position:', before_walk)

  // walk forward for a while — normal roam speed is ~4 tiles/s, so ~13s covers ~50 blocks.
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(13_000)
  await page.keyboard.up('KeyW')
  await page.waitForTimeout(5_200) // clear the 5s IndexedDB cadence so the final rest position lands

  const walked_to = await ctl_position(page)
  console.log('[session-position] walked to:', walked_to)
  const walked_dist =
    walked_to && before_walk ? Math.hypot(walked_to[0] - before_walk[0], walked_to[2] - before_walk[2]) : 0
  expect(walked_dist, 'holding W for 13s should cover a real distance').toBeGreaterThan(20)

  await page.screenshot({
    path: `${OUT}/session_position_before_refresh.png`,
  })

  await page.reload({ waitUntil: 'domcontentloaded' })

  const restored = await wait_for_controller(page)
  console.log('[session-position] post-refresh position:', restored)
  expect(restored, 'the DEV rig must re-expose __voxel_ctl after a reload').toBeTruthy()

  await page.screenshot({
    path: `${OUT}/session_position_after_refresh.png`,
  })

  // physics/settle can nudge Y a little (ground snap) — the (x,z) plane is the meaningful continuity signal.
  const xz_drift = Math.hypot(restored![0] - walked_to![0], restored![2] - walked_to![2])
  console.log('[session-position] xz drift after refresh:', xz_drift)
  expect(
    xz_drift,
    'a refresh should land within a few blocks of where we stood, never back at WORLD_SPAWN'
  ).toBeLessThan(5)

  const dist_from_world_spawn = Math.hypot(restored![0] - 137.5, restored![2] - 164.5)
  expect(dist_from_world_spawn, 'the restored position must NOT be the hardcoded WORLD_SPAWN').toBeGreaterThan(15)

  expect(pageErrors, `unexpected console/page errors:\n${pageErrors.join('\n')}`).toEqual([])
})
