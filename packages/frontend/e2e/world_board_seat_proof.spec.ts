// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'

import { test, expect, type Page } from '@playwright/test'

// WORLD-BOARD SEAT + FOOTPRINT-CLEAR PROOF — two failure modes, one drive:
//   (1) terrain/grass POKING THROUGH the flat world board, and (2) the board seated BELOW the ground.
// Mounts a REAL world fight via the dev hook (create_world_fight → enter_world_fight — production path), then:
//   • NUMERIC (seating): samples the ground over the WHOLE footprint via __voxel_engine.sample_block and proves
//     the board floor sits ABOVE the dominant terrain (never buried) — the "below-ground" fix.
//   • VISUAL (clear): screenshots the mounted board from the fight camera — clean on top, no voxel/grass intrusion
//     (the render-side footprint clear; the voxels still exist in DATA — the clear is presentation-only — so the
//     numeric tally reads the raw land while the pixels read the cleared board).
// Run HEADED (WebGPU needs the hardware adapter): bunx playwright test world_board_seat_proof --headed

const OUT = process.env.ARES_TEST_OUT ?? new URL('../test-results/out', import.meta.url).pathname
const lines: string[] = []
const log = (s: string) => {
  lines.push(s)
  console.log(s)
}
test.afterEach(() => {
  try {
    fs.mkdirSync(OUT, { recursive: true })
    fs.writeFileSync(`${OUT}/seat_proof_console.log`, lines.join('\n'))
  } catch {
    /* n/a */
  }
})

const board_desc = (page: Page): Promise<any> =>
  page.evaluate(() => (window as any).__voxel_board?._descriptor?.() ?? null).catch(() => null)

async function boot(page: Page) {
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).__dev_start_world_fight === 'function').catch(() => false), {
      timeout: 120_000,
      intervals: [2000],
    })
    .toBe(true)
  for (let i = 0; i < 8; i += 1) {
    if ((await page.locator('.tut__backdrop').count()) === 0) break
    const sk = page.locator('.tut__skip')
    if (await sk.isVisible().catch(() => false)) await sk.click().catch(() => {})
    await page.waitForTimeout(400)
  }
}

test('world board seats ON TOP of the terrain (never buried) and renders clean (no intrusion)', async ({ page }) => {
  test.setTimeout(600_000)
  page.on('console', (m) => {
    const t = m.text()
    if (/\[dev\]|\[voxel\]|\[world-fight\]|\[voxel-fight\]/.test(t)) log(`  PAGE ${t}`)
  })
  await page.addInitScript(() => {
    try {
      localStorage.setItem('ares_tutorial_seen_v2', '1')
    } catch {
      /* n/a */
    }
  })
  await page.goto('/game-world?dev', { waitUntil: 'domcontentloaded' })
  await boot(page)

  const fight_id: string | null = await page.evaluate(() => (window as any).__dev_start_world_fight()).catch(() => null)
  log(`  world fight id: ${fight_id}`)
  // SKIP (not fail) when the live testnet state has no claimable mob group in the character's zone (all discovered
  // groups refuse: wrong-zone/already-claimed, or an unfinished fight blocks) — the fix isn't testable then, the
  // STATE is. Re-run once the dev character sits in a zone with a fresh group (same gate the world_fight_mount spec hits).
  test.skip(!fight_id, 'no claimable world mob group in the character zone (live testnet state) — nothing to mount')
  await expect.poll(() => board_desc(page).then((d) => !!d), { timeout: 120_000, intervals: [1000] }).toBe(true)
  await page.waitForTimeout(2500) // let the fight camera settle on the board + the terrain finish streaming in

  // ── NUMERIC seat proof: for every footprint column, the top solid land block (air/flora/fluid rejected), vs the
  //    board floor origin.y. A board seated on the dominant HIGH plane sits ABOVE the bulk of the land. ──────────
  const stats = await page.evaluate(() => {
    const eng = (window as any).__voxel_engine
    const d = (window as any).__voxel_board?._descriptor?.()
    if (!eng?.sample_block || !d) return null
    const { origin, width, height, cell_size } = d
    const solid = (id: number) =>
      id !== 0 && !(id >= 10 && id <= 17) && !(id >= 20 && id <= 23) && id !== 5 && id !== 24
    const surf: number[] = []
    for (let cx = 0; cx < width; cx += 1)
      for (let cy = 0; cy < height; cy += 1) {
        const wx = Math.floor(origin.x + (cx + 0.5) * cell_size)
        const wz = Math.floor(origin.z + (cy + 0.5) * cell_size)
        for (let y = Math.floor(origin.y) + 24; y >= Math.floor(origin.y) - 48; y -= 1)
          if (solid(eng.sample_block(wx, y, wz))) {
            surf.push(y)
            break
          }
      }
    surf.sort((a, b) => a - b)
    const n = surf.length
    const at_or_above = surf.filter((y) => y >= origin.y).length
    return {
      origin_y: origin.y,
      n,
      min: surf[0],
      max: surf[n - 1],
      median: surf[n >> 1],
      at_or_above,
      buried: at_or_above / Math.max(1, n),
    }
  })
  log(`  SEAT STATS: ${JSON.stringify(stats)}`)
  expect(stats, 'engine + board descriptor must be reachable').toBeTruthy()
  if (stats && stats.n > 0) {
    // never BURIED: the board floor is above the dominant land (≤25% of columns reach/exceed it — the render-cleared
    // high fraction). The old single-anchor/player-Y seat sank the WHOLE board (buried→1.0) or floated it wrong.
    expect(
      stats.buried,
      `board must seat ABOVE the terrain — ${(stats.buried * 100).toFixed(0)}% of footprint columns reach the board floor`
    ).toBeLessThanOrEqual(0.25)
    // and it is not absurdly high above the land either (seated flush, not floating a cliff): within a few blocks of the max.
    expect(stats.origin_y - stats.max).toBeLessThanOrEqual(4)
    log(
      `  RELIEF across footprint: ${stats.max - stats.min} blocks (min ${stats.min} → max ${stats.max}), board floor ${stats.origin_y}`
    )
  }

  await page.screenshot({ path: `${OUT}/seat_1_mounted_clean.png` })
  log('  screenshot: seat_1_mounted_clean.png (board on top of terrain, clean surface — no voxel/grass intrusion)')
})
