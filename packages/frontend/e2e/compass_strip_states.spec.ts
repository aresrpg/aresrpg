// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { test, expect } from '@playwright/test'

// COMPASS-STRIP STATES PROOF — drives the REAL app and pins the two fixed states:
//   (e) coords render as WHOLE BLOCKS (no decimals), one subtle background chip per axis;
//   (d) the zone column ALWAYS reflects the avatar: inside the u32 zone grid → `ZONE zx·zy …`; outside it
//       (x or z below 0 — reachable on foot, the §4 spawn box hugs the world corner) → the honest
//       OUT-OF-BOUNDS label instead of the dead '—' + vanished [F] (the prior regression).
// The out-of-grid state is forced deterministically via the DEV rig's controller teleport (embed_voxel_dev
// `__voxel_ctl`, the same hook the qa drives use) — no minutes-long walk to the world corner.

const DEV_KEY = process.env.VITE_DEV_KEY ?? ''

test('compass strip: integer coord chips in-grid, honest OUT OF BOUNDS beyond the zone grid', async ({
  page,
}, testInfo) => {
  await page.addInitScript((devKey: string) => {
    ;(window as any).__ARES_DEV_KEY = devKey
  }, DEV_KEY)

  await page.goto('/game-world?dev', { waitUntil: 'domcontentloaded' })

  // First-boot: mint a throwaway character if the roster is empty (the movement spec's exact pattern).
  const createAndPlay = page.locator('button:has-text("PLAY")')
  let needsCreate = false
  for (let i = 0; i < 15 && !needsCreate; i++) {
    needsCreate = await createAndPlay.isVisible().catch(() => false)
    if (!needsCreate) {
      const stripUp = await page
        .locator('.gw-compass')
        .isVisible()
        .catch(() => false)
      if (stripUp) break
      await page.waitForTimeout(3000)
    }
  }
  if (needsCreate) {
    await page.getByPlaceholder('Enter name...').fill(`StripQA${Date.now() % 100000}`)
    await createAndPlay.click()
    await expect(createAndPlay, 'character mint must clear the create screen').not.toBeVisible({ timeout: 40_000 })
  }

  // The strip self-gates on the walker's pose publish — its appearance IS the world-scene mount signal.
  const strip = page.locator('.gw-compass')
  await expect(strip, 'the compass strip mounts once the walker publishes a pose').toBeVisible({ timeout: 90_000 })

  // ── (e) coord chips: exactly three, integers only (signed), each its own chip element ────────────────────
  const chips = page.locator('.gw-compass__pos-chip')
  await expect(chips).toHaveCount(3)
  for (let i = 0; i < 3; i++) {
    const text = (await chips.nth(i).textContent())?.trim() ?? ''
    expect(text, `axis chip ${i} renders a whole block value, no decimals`).toMatch(/^-?\d+$/)
  }

  // ── state A: inside the zone grid — the zone column names the zone under the avatar ──────────────────────
  const zone = page.locator('.gw-compass__zone')
  await expect(zone, 'in-grid: the zone column names the current zone').toContainText(/Zone \d+·\d+/, {
    timeout: 30_000,
  })
  await strip.screenshot({ path: testInfo.outputPath('strip_in_grid.png') })

  // ── state B: teleport past the world origin (x,z < 0 — outside the u32 zone grid) via the DEV rig ────────
  const teleported = await page.evaluate(() => {
    const ctl = (window as any).__voxel_ctl
    if (!ctl?.teleport) return false
    const y = Number(ctl.position?.[1] ?? 80)
    ctl.teleport([-8, y + 2, -8])
    return true
  })
  expect(teleported, 'the DEV rig controller (__voxel_ctl) must expose teleport').toBe(true)

  await expect(zone, 'out of the grid: the honest OUT-OF-BOUNDS label, never a dead —').toContainText(
    /out of bounds/i,
    { timeout: 15_000 }
  )
  // the chips keep rendering (signed whole blocks) — the "coords show but zone info vanished" regression is dead.
  await expect(chips.first()).toHaveText(/^-\d+$/, { timeout: 10_000 })
  await strip.screenshot({ path: testInfo.outputPath('strip_out_of_bounds.png') })
})
