// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENG-12 REGRESSION capture (throwaway diagnostic) — the froxel god-ray blowout that was flagged:
//   (a) open lakeside ground-level  — white VERTICAL streak-walls near lake/forest
//   (b) sun-toward at LOW sun        — CONCENTRIC WHITE ARCS radiating from the sun (froxel HG phase blown)
//   (c) under dense canopy           — beams must SURVIVE (kept, just clamped)
//   (d) slow 360° pan (video)        — lighting must be STABLE (no re-light on rotation)
// Shoots at 2560×1440 (dsf 2). Reuses atmo_acceptance.spec.js's pin/settle protocol.
// Output → /tmp/aresrpg-engine-artifacts/eng12/<label>_<frame>.png (+ pan webm).

import { mkdir } from 'node:fs/promises'

import { test } from '@playwright/test'

import { open_recorded_page } from './_shared.js'

const OUT = '/tmp/aresrpg-engine-artifacts/eng12'
const DEMO = process.env.ENG12_DEMO || 'http://localhost:5211/demo/'
const LABEL = process.env.ENG12_LABEL || 'before'

test.describe.configure({ mode: 'serial' })

/** @param {import('@playwright/test').Page} page @param {number} ms */
const settle = (page, ms) => page.evaluate((t) => new Promise((r) => setTimeout(r, t)), ms)

const install_pin = (/** @type {import('@playwright/test').Page} */ page) =>
  page.evaluate(() => {
    const w = /** @type {any} */ (window)
    if (w.__pin_installed) return
    w.__pin_installed = true
    const e = w.__engine
    const orig_pos = e.set_camera_position.bind(e)
    const orig_ori = e.set_camera_orientation.bind(e)
    e.set_camera_position = (/** @type {any} */ p) => orig_pos(w.__pin?.pos ?? p)
    e.set_camera_orientation = (/** @type {any} */ y, /** @type {any} */ pi) =>
      w.__pin ? orig_ori(w.__pin.yaw, w.__pin.pitch) : orig_ori(y, pi)
  })

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ pos?: [number,number,number], toward_sun?: boolean, yaw?: number, pitch?: number, tod?: number }} o
 */
async function pose(page, o, attempt = 0) {
  try {
    await page.waitForFunction(() => /** @type {any} */ (window).__engine != null, null, { timeout: 60_000 })
    await install_pin(page)
    await page.evaluate((p) => {
      const w = /** @type {any} */ (window)
      const e = w.__engine
      if (typeof p.tod === 'number') e.set_time_of_day(p.tod)
      const cur = e.get_stats().camera_position
      let { yaw } = p
      let pitch = p.pitch ?? 0
      if (p.toward_sun) {
        const s = w.__atmo.sun_direction.value
        yaw = Math.atan2(-s.x, -s.z)
        pitch = Math.asin(Math.max(-1, Math.min(1, s.y)))
      }
      const prev = w.__pin
      w.__pin = { pos: p.pos ?? prev?.pos ?? cur, yaw: yaw ?? prev?.yaw ?? 0, pitch }
    }, o)
    if (o.pos) {
      await page.waitForFunction(
        (target) => {
          const e = /** @type {any} */ (window).__engine
          if (!e) return false
          const c = e.get_stats().camera_position
          return Math.abs(c[0] - target[0]) < 2 && Math.abs(c[1] - target[1]) < 2 && Math.abs(c[2] - target[2]) < 2
        },
        o.pos,
        { timeout: 30_000 }
      )
      await settle(page, 1500)
      await page.waitForFunction(
        () => {
          const e = /** @type {any} */ (window).__engine
          return e != null && e.get_stats().chunk_queue_depth === 0
        },
        null,
        { timeout: 120_000 }
      )
    }
  } catch (e) {
    if (attempt < 2) {
      await page.waitForFunction(() => /** @type {any} */ (window).__engine != null, null, { timeout: 90_000 })
      return pose(page, o, attempt + 1)
    }
    throw e
  }
  await settle(page, 900)
}

test('eng12 regression framings', async ({ browser }) => {
  test.setTimeout(420_000)
  await mkdir(OUT, { recursive: true })
  const { page, finish } = await open_recorded_page(browser, `eng12_${LABEL}`, { width: 2560, height: 1440 })
  /** @type {string[]} */
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/Failed to load resource|MetaMask|draco/i.test(t)) return
    errors.push(`console.error: ${t}`)
  })
  await page.goto(`${DEMO}?tier=high`)
  await page.waitForFunction(
    () => {
      const e = /** @type {any} */ (window).__engine
      if (!e) return false
      const s = e.get_stats()
      return s.chunk_queue_depth === 0 && s.fps > 5
    },
    null,
    { timeout: 120_000 }
  )

  // Log the live froxel knobs for the record.
  const knobs = await page.evaluate(() => {
    const a = /** @type {any} */ (window).__atmo
    return {
      shaft_gain: a.froxels.shaft_gain.value,
      enclosure_density: a.config.froxel.enclosure_density,
      near_haze: a.near_haze.value,
      godray_max_density: a.config.godrays.max_density,
    }
  })
  console.log(`[eng12:${LABEL}] knobs:`, JSON.stringify(knobs))

  // Proven-render poses (SEA_LEVEL=128; terrain ~135-175). Lifted from veg_ocean/shade_verify.
  const SHORE = /** @type {[number,number,number]} */ ([190, 134, 172]) // open water shore (the "lakeside")
  const CANOPY = /** @type {[number,number,number]} */ ([44, 150, -74]) // under dense forest canopy
  const OPEN = /** @type {[number,number,number]} */ ([70, 215, 70]) // open spawn-hill vista

  // (a) OPEN LAKESIDE ground-level — over the shore water, mid-morning sun. Open air beside forest ⇒
  // where the enclosure fog wrongly thickens rho (the white streak-walls).
  await pose(page, { tod: 0.32, pos: SHORE, yaw: 1.4, pitch: -0.1 })
  await page.screenshot({ path: `${OUT}/${LABEL}_a_lakeside.png` })

  // (b) SUN-TOWARD at LOW sun from the open vista — the concentric-arc framing. tod 0.72 ⇒ sun_y≈0.12.
  await pose(page, { tod: 0.72, toward_sun: true, pos: OPEN })
  await settle(page, 1200)
  await page.screenshot({ path: `${OUT}/${LABEL}_b_sun_toward.png` })

  // (c) UNDER DENSE CANOPY — inside the clutter, pitched at the floor; sun climbing so beams rake gaps.
  await pose(page, { tod: 0.42, pos: CANOPY, yaw: 0.5, pitch: -0.35 })
  await settle(page, 1000)
  await page.screenshot({ path: `${OUT}/${LABEL}_c_canopy.png` })

  // (c2) CANOPY TOWARD THE LOW SUN — the cathedral-beam framing (forward-scatter cone, sun raking
  // through gaps toward the camera). This is where the froxel shafts should read as visible beams.
  await pose(page, { tod: 0.7, toward_sun: true, pos: CANOPY })
  await settle(page, 1000)
  await page.screenshot({ path: `${OUT}/${LABEL}_c2_canopy_sun.png` })

  // (e) FOG-SEA MONEY SHOT (Hodilton) — a high summit looking across the valleys with the alpine sea
  // driven up via weather_density. Summits break through a white sea; the sun-lit sea glows (bloom).
  await pose(page, { tod: 0.62, pos: [70, 245, 70], yaw: 2.4, pitch: -0.12 })
  await page.evaluate(() => {
    ;/** @type {any} */ (window).__atmo.weather_density.value = 2.2
  }) // alpine inversion
  await settle(page, 1200)
  await page.screenshot({ path: `${OUT}/${LABEL}_e_fog_sea.png` })
  await page.evaluate(() => {
    ;/** @type {any} */ (window).__atmo.weather_density.value = 1.0
  }) // restore

  // (d) SLOW 360° PAN at the shore (video) — hold pos, sweep yaw over ~8 s at low sun.
  await pose(page, { tod: 0.66, pos: SHORE, yaw: 0, pitch: -0.05 })
  await settle(page, 600)
  await page.evaluate(async () => {
    const w = /** @type {any} */ (window)
    const e = w.__engine
    const start = performance.now()
    const dur = 8000
    await new Promise((resolve) => {
      const step = () => {
        const t = Math.min(1, (performance.now() - start) / dur)
        w.__pin = { pos: [190, 134, 172], yaw: t * Math.PI * 2, pitch: -0.05 }
        e.set_camera_orientation(t * Math.PI * 2, -0.05)
        if (t < 1) requestAnimationFrame(step)
        else resolve(undefined)
      }
      requestAnimationFrame(step)
    })
  })
  await finish('pan_shore')

  if (errors.length) console.log(`[eng12:${LABEL}] ERRORS:\n` + errors.join('\n'))
  else console.log(`[eng12:${LABEL}] zero engine errors`)
})
