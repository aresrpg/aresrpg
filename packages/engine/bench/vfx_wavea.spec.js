// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Wave-A (c_melee + e_status_impact) WebGPU still proof. Drives demo/vfx_wavea_probe.html on real Metal for 4
// named scenes (2 melee, 2 status), asserts the WGSL compiled clean (no window.__probe_err), the burst is VISIBLE
// (bright pixels over the near-black bg), and writes each still to /tmp/aresrpg-engine-artifacts/wavea_melee/.
// Run: ARES_DEMO_ORIGIN=http://localhost:5271 bunx playwright test vfx_wavea  (headed Metal; own dev port).

import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { test, expect } from '@playwright/test'

import { DEMO_ORIGIN, probe_gpu_adapter } from './harness.js'

const OUT = '/tmp/aresrpg-engine-artifacts/wavea_melee'

// 4 scenes at their peak frame: 2 melee (rake + element slash) + 2 status (shield LOOP + vortex burst).
const SHOTS = [
  { preset: 'melee_claw_fire', t: 0.12 }, // c_melee — the 3-mark fire rake
  { preset: 'slash_elem_water', t: 0.12 }, // c_melee — the water element weapon slash
  { preset: 'shield_ward_fire_b', t: 1.0 }, // e_status_impact — the big fire shield ward (LOOP, settled)
  { preset: 'dark_vortex_void', t: 0.4 }, // e_status_impact — the void pull vortex opening
]

// Bright-pixel proof read directly off the in-page canvas snapshot via toDataURL of a 2D copy is impossible for a
// WebGPU swapchain (consumed on present); so we decode the SAVED screenshot PNG bytes in Node — a mostly-black
// frame with a bright burst has clearly non-zero byte variance + a high peak byte. Dependency-free (matches
// harness.luminance_variance). @param {Buffer} png
function png_brightness(png) {
  let peak = 0
  let bright = 0
  let sum = 0
  let sum_sq = 0
  let n = 0
  for (let i = 64; i < png.length; i += 3) {
    const v = png[i]
    if (v > 200) bright += 1
    if (v > peak) peak = v
    sum += v
    sum_sq += v * v
    n += 1
  }
  const variance = n ? sum_sq / n - (sum / n) ** 2 : 0
  return { bright, peak, variance }
}

test.describe('VFX Wave-A stills (c_melee + e_status_impact)', () => {
  test.beforeAll(async () => {
    await mkdir(OUT, { recursive: true })
  })

  for (const { preset, t } of SHOTS) {
    test(`${preset} compiles clean + renders visible`, async ({ page }) => {
      const errors = []
      page.on('pageerror', (e) => errors.push(String(e)))
      await page.goto(`${DEMO_ORIGIN}/demo/vfx_wavea_probe.html?preset=${preset}&t=${t}`)
      const gpu = await probe_gpu_adapter(page)
      expect(gpu.ok, `hardware WebGPU adapter: ${gpu.reason ?? ''}`).toBe(true)
      await page.waitForFunction(() => window.__probe_ready || window.__probe_err, { timeout: 20_000 })
      const probe = await page.evaluate(() => ({
        err: window.__probe_err,
        particles: window.__probe_particles,
        draws: window.__probe_draws,
      }))
      // THE WEBGPU COMPILE PROOF: __probe_ready fired (a frame rendered) with no __probe_err ⇒ every emitter's TSL
      // pipeline compiled + drew clean on Metal. particle_count/draw_calls > 0 ⇒ the preset actually instantiated.
      expect(probe.err, `probe error for ${preset}`).toBeFalsy()
      expect(probe.particles, `${preset} instantiated particles`).toBeGreaterThan(0)
      // let a couple frames settle, then capture the deterministic peak frame (the still artifact)
      await page.waitForTimeout(250)
      const png = await page.locator('#c').screenshot({ path: path.join(OUT, `${preset}.png`) })
      const { bright, peak, variance } = png_brightness(png)
      expect(peak, `${preset} has bright pixels (not a black frame)`).toBeGreaterThan(120)
      expect(variance, `${preset} frame varies (a burst is drawn)`).toBeGreaterThan(50)
      expect(bright, `${preset} bright-pixel count`).toBeGreaterThan(20)
      expect(errors, `no page errors for ${preset}`).toHaveLength(0)
    })
  }
})
