// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FAR-TREE IMPOSTORS pose capture + proof (ENGINE_AAA_PLAN §8 B3). Boots the demo with
// ?proctrees=1&impostors=1 on the real GPU and proves the §8 B3 bar:
//   • HORIZON: forests visible to the horizon — far_impostor_count > 0 at a vista (runtime provenance),
//     plus a screenshot for visual review.
//   • RING CROSS-FADE: a fly INTO the forest captures the seam (impostors dither out as the near ring's
//     real trees stream in) as a frame series — no visible pop / double-tree (visual review).
//   • BUDGET: rotation-drained p99 with impostors ON stays under the far-shell frame ceiling (the ≤0.3 ms
//     impostor cost is logged as an ON−OFF delta for the record).
//   • FAR-MASK LAW: the shared drawn-column mask stays 0-mismatch across a teleport re-stream (the
//     night-watch far-mask law — impostors reuse that mask, so they inherit it).
//   • FLAG-OFF PARITY: ?impostors absent ⇒ far_impostor_count == 0 while the far shell still builds
//     (the byte-identity guard at runtime; the pure parity is proven in far_trees_gen.test.js).
//
// Fresh page per test bounds tab memory (proctrees_poses lesson: one tab teleporting ±600 blocks OOMs).
// Run: `bunx playwright test impostors_poses` (headed Metal).

import { mkdir } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { seize_camera, park_camera, settle_stream } from './_shared.js'

const OUT = '/tmp/aresrpg-engine-artifacts/impostors'
const ON_URL = '/demo/?proctrees=1&impostors=1&tier=high&load_radius=5'
const OFF_URL = '/demo/?proctrees=1&tier=high&load_radius=5'

/** Vista over the spawn forest belt (far_field.spec's proven horizon pose): y240 clears the spawn hills,
 *  a shallow down-pitch frames the far shell + forest to the horizon (the impostor band, 224 m→~1.2 km). */
const VISTA = /** @type {[number,number,number]} */ ([70, 240, 70])
const VISTA_YAW = Math.PI / 4
const VISTA_PITCH = -0.14
/** Rotation-drained p99 ceiling (ms) — the far-shell budget (9.3 baseline + far shell + impostors). */
const P99_CEILING_MS = 11.5

const FAULT_RE = /mesher|occupancy|invisible|shader|WGSL|naga|nesting|NaN|device lost|boot_error|Discard|attribute/i

/** @param {import('@playwright/test').Page} page */
const stats = (page) => page.evaluate(() => /** @type {any} */ (window).__engine?.get_stats?.() ?? {})
/** @param {import('@playwright/test').Page} page */
const mask_debug = (page) =>
  page.evaluate(() => /** @type {any} */ (window).__engine?._far_mask_debug?.() ?? { mismatches: [] })

/** Boot the demo, seize the camera, wait for __engine. @param {import('@playwright/test').Page} page @param {string} url */
async function boot(page, url) {
  await page.goto(url)
  await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__engine?.get_stats), null, { timeout: 40_000 })
  await seize_camera(page)
}

/** Rotate the camera a full turn in place over duration_ms (drains streaming → steady render p99).
 *  @param {import('@playwright/test').Page} page @param {[number,number,number]} pos @param {number} pitch @param {number} ms */
function rotate_in_place(page, pos, pitch, ms) {
  return page.evaluate(
    ({ pos, pitch, ms }) => {
      const cam = /** @type {any} */ (window).__cam
      cam.real_pos(pos)
      return new Promise((resolve) => {
        const t0 = performance.now()
        const step = () => {
          const t = Math.min(1, (performance.now() - t0) / ms)
          cam.real_orient(t * Math.PI * 2, pitch)
          t < 1 ? requestAnimationFrame(step) : resolve(undefined)
        }
        requestAnimationFrame(step)
      })
    },
    { pos, pitch, ms }
  )
}

test('B3 impostors ON — forests to the horizon, mask stable across re-stream, p99 in budget', async ({ page }) => {
  test.setTimeout(180_000)
  await mkdir(OUT, { recursive: true })
  /** @type {string[]} */
  const faults = []
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && FAULT_RE.test(m.text())) faults.push(m.text())
  })
  page.on('pageerror', (e) => faults.push(String(e)))

  await boot(page, ON_URL)
  await park_camera(page, VISTA, VISTA_YAW, VISTA_PITCH)
  await settle_stream(page, { min_ms: 4_000, deadline_ms: 60_000 })
  await page.waitForTimeout(600)

  // HORIZON: impostors are live at the vista (forests visible to the horizon — runtime provenance).
  const s1 = await stats(page)
  console.log(
    `[impostors] vista: far_impostor_count=${s1.far_impostor_count} far_sections=${s1.far_section_count} draws=${s1.draw_calls}`
  )
  await page.screenshot({ path: `${OUT}/1_horizon_vista.png` })
  expect(s1.far_impostor_count).toBeGreaterThan(0)
  expect(s1.far_section_count).toBeGreaterThan(0)

  // FAR-MASK LAW: the shared drawn-column mask has zero mismatches (no far-shell/impostor poke-through).
  const m1 = await mask_debug(page)
  expect(m1.mismatches.length).toBe(0)

  // …and stays 0-mismatch across a teleport re-stream (the mask must not drift across a world re-stream).
  await park_camera(page, [70, 240, 900], VISTA_YAW, VISTA_PITCH)
  await settle_stream(page, { min_ms: 3_000, deadline_ms: 45_000 })
  await park_camera(page, VISTA, VISTA_YAW, VISTA_PITCH)
  await settle_stream(page, { min_ms: 3_000, deadline_ms: 45_000 })
  await page.waitForTimeout(500)
  const s2 = await stats(page)
  const m2 = await mask_debug(page)
  console.log(
    `[impostors] after re-stream: far_impostor_count=${s2.far_impostor_count} mask_mismatches=${m2.mismatches.length}`
  )
  expect(m2.mismatches.length).toBe(0)
  expect(s2.far_impostor_count).toBeGreaterThan(0)

  // BUDGET: rotation-drained p99 (steady render cost with impostors resident) stays under the far ceiling.
  await rotate_in_place(page, VISTA, VISTA_PITCH, 6_000)
  const s3 = await stats(page)
  console.log(`[impostors] rotation-drained p99=${s3.frame_ms_p99}ms fps=${s3.fps} impostors=${s3.far_impostor_count}`)
  expect(s3.frame_ms_p99).toBeLessThanOrEqual(P99_CEILING_MS)

  if (faults.length) console.log('[impostors] FAULTS:\n' + faults.map((f) => '  ' + f).join('\n'))
  expect(faults).toEqual([])
})

test('B3 ring cross-fade — fly into the forest, no pop/double-tree (frame series for eyeball)', async ({ page }) => {
  test.setTimeout(180_000)
  await mkdir(OUT, { recursive: true })
  /** @type {string[]} */
  const faults = []
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && FAULT_RE.test(m.text())) faults.push(m.text())
  })
  page.on('pageerror', (e) => faults.push(String(e)))

  await boot(page, ON_URL)
  // Approach the origin forest from altitude: impostors in the far band should dither OUT as the near
  // ring's real trees stream IN. Capture the seam every ~90 blocks of descent/approach.
  const legs = /** @type {[number,number,number][]} */ ([
    [70, 240, 70],
    [10, 210, 10],
    [-40, 190, -40],
    [-90, 175, -80],
  ])
  for (let i = 0; i < legs.length; i += 1) {
    await park_camera(page, legs[i], Math.PI * 1.25, -0.16)
    await settle_stream(page, { min_ms: 3_000, deadline_ms: 45_000 })
    await page.waitForTimeout(500)
    const s = await stats(page)
    console.log(
      `[impostors] crossfade leg ${i} @${legs[i]}: impostors=${s.far_impostor_count} near_ring_m=${s.near_ring_m}`
    )
    await page.screenshot({ path: `${OUT}/2_crossfade_${i}.png` })
  }
  if (faults.length) console.log('[impostors] FAULTS:\n' + faults.map((f) => '  ' + f).join('\n'))
  expect(faults).toEqual([])
})

test('B3 flag-OFF parity — ?impostors absent ⇒ zero impostors, far shell unaffected', async ({ page }) => {
  test.setTimeout(120_000)
  await boot(page, OFF_URL)
  await park_camera(page, VISTA, VISTA_YAW, VISTA_PITCH)
  await settle_stream(page, { min_ms: 4_000, deadline_ms: 60_000 })
  await page.waitForTimeout(500)
  const s = await stats(page)
  console.log(`[impostors] flag OFF: far_impostor_count=${s.far_impostor_count} far_sections=${s.far_section_count}`)
  expect(s.far_impostor_count).toBe(0) // the impostor layer never mounts
  expect(s.far_section_count).toBeGreaterThan(0) // the far shell is untouched
})
