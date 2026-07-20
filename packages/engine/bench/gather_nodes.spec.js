// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// GATHER-NODE PROCEDURAL PROP CAPTURE (rework) — the pixel proof that a resource node now
// renders REAL procedural wheat/herb/ore (synth_gather_buffer → crossed-billboard sprite) instead of the
// rejected item-ICON card. Drives the ?gather=1 demo (gather_demo.js) — 7 showcase nodes on a grass ground +
// a filler back row (~20 resident) — at the two gather distances, pristine + depleted, and reads the frame
// cost as an A/B (20 nodes vs empty). Screenshots land in /tmp/aresrpg-engine-artifacts for review; the
// automated gate is non-black (a dead/blank render fails) + a small ~20-node frame-cost delta.

import { test, expect } from '@playwright/test'

import { DEMO_ORIGIN, capture_canvas_screenshot, capture_frames, percentile, probe_gpu_adapter } from './harness.js'

const url = (q) => `${DEMO_ORIGIN}/demo/index.html?gather=1&${q}`

async function goto_gather(page, q) {
  await page.goto(url(q), { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => /** @type {any} */ (window).__capture_ready === true, null, { timeout: 45_000 })
  await page.waitForTimeout(400) // a couple of extra frames so sway/glow are mid-animation in the shot
}

test.describe('gather-node procedural props', () => {
  for (const dist of [12, 25]) {
    test(`legible at ${dist} m — non-black render`, async ({ page }) => {
      await goto_gather(page, `dist=${dist}`)
      const probe = await probe_gpu_adapter(page)
      expect(probe.ok, probe.reason ?? 'gpu').toBeTruthy()
      const shot = await capture_canvas_screenshot(page, `gather_${dist}m`)
      expect(shot.variance, 'non-black render').toBeGreaterThan(20)
    })
  }

  test('hero close-up — the game exploration angle (elevated, looking down at the row)', async ({ page }) => {
    await goto_gather(page, 'dist=7&eye=4') // ~7 m out, 4 m up → sprites read face-on + full (the real gather cam)
    const shot = await capture_canvas_screenshot(page, 'gather_hero')
    expect(shot.variance, 'non-black render').toBeGreaterThan(20)
  })

  test('depleted A/B — a harvested front row renders (thin+dim+droop)', async ({ page }) => {
    await goto_gather(page, 'dist=12&deplete=1')
    const shot = await capture_canvas_screenshot(page, 'gather_12m_depleted')
    expect(shot.variance, 'non-black render').toBeGreaterThan(20)
  })

  test('frame-cost delta of ~20 resident nodes stays small', async ({ page }) => {
    await goto_gather(page, 'dist=12&nodes=0') // baseline: empty grass stage, no props
    const base = percentile((await capture_frames(page, 120)).deltas_ms, 99)
    await goto_gather(page, 'dist=12') // 20 node clusters resident
    const withn = await capture_frames(page, 120)
    const p99 = percentile(withn.deltas_ms, 99)
    const delta = p99 - base
    console.log(
      `[gather perf] baseline p99=${base.toFixed(2)}ms  20-nodes p99=${p99.toFixed(2)}ms  delta=${delta.toFixed(2)}ms  quads=${withn.last_stats?.quad_count ?? '?'}`
    )
    expect(delta, 'the ~20 node clusters add little to the frame').toBeLessThan(2)
  })
})
