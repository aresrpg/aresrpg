// FAR-MASK TRAVERSE gate (night-watch 2026-07-04) — the traveled-session "far sheet" oracle.
//
// A long-session screenshot showed the far-shell sheet over near drawn terrain while
// fresh-pose proofs passed — so the suspect was DRIFT in ring_manager.rendered_columns over travel
// (the mask that hides the far shell over drawn columns going stale). This gate REPRODUCES a long
// traverse (a 2 km box loop + a re-entry leg, direction changes, tier=ultra, high-DPR) and, at each
// settled waypoint, runs the DETERMINISTIC oracle engine._far_mask_debug(): every column
// terrain_renderer is DRAWING must read mask=255 (far shell discarded there). Any drawn column with
// mask≠255 ⇒ the far shell would poke over drawn near terrain ⇒ the sheet. Zero mismatches across the
// whole traverse = green. Verified 3× consecutive on the Studio (2026-07-04): 18/18 waypoints clean —
// the drawn-column mask bookkeeping does NOT drift (uploaded_keys guards make mark/unmark exact; the
// 41-chunk mask window bounds every supported load_radius ≤ 8; LRU store churn never orphans a count).
//
// Origin: DEMO_ORIGIN (ARES_DEMO_ORIGIN env-overridable — the night-watch ran it on an isolated :5231).

import { mkdir } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { seize_camera, settle_stream, get_stats } from './_shared.js'
import { DEMO_ORIGIN, probe_gpu_adapter } from './harness.js'

const ORIGIN = DEMO_ORIGIN
const SEED = 'aresrpg'
const ART = '/tmp/aresrpg-engine-artifacts/night_watch'
// 1440p at deviceScaleFactor 2 ≈ real "1440@dsf2" GPU load. The sheet is a bookkeeping bug, not
// a resolution artifact — but we stress at the real fill resolution so any interaction shows.
const VIEWPORT = { width: 2560, height: 1440 }

/** A long multi-leg traverse (>1500 m total) with direction changes — the exact churn that drifts the
 *  rendered_columns bookkeeping. Altitude 150 m, looking out over the belt with a shallow downward
 *  pitch (where the sheet is visible). Legs chosen to cross many chunk boundaries in several headings. */
// Altitude 280 m clears the spawn belt (probed surface ≈195 m near spawn) so every leg is a real
// horizon VISTA — the far shell reads to the horizon and any poke-through over near terrain is in frame.
const ALT = 280
const START = /** @type {[number,number,number]} */ ([70, ALT, 70])
const LEGS = /** @type {{ to: [number,number,number], yaw: number }[]} */ ([
  { to: [70, ALT, -520], yaw: Math.PI }, // 590 m due -Z
  { to: [560, ALT, -520], yaw: -Math.PI / 2 }, // 490 m due +X
  { to: [560, ALT, 60], yaw: 0 }, // 580 m due +Z
  { to: [120, ALT, 60], yaw: Math.PI / 2 }, // 440 m due -X  (total ≈ 2100 m, box loop)
])
const PITCH = -0.14 // shallow downward — the known-good vista pitch (far_field.spec VISTA)
const FLY_MS = 3000 // per leg — slow enough that streaming keeps up, long enough to churn the store

/** Drives the camera in a straight line while pushing the REAL setter every frame (demo push is seized).
 * @param {import('@playwright/test').Page} page
 * @param {[number,number,number]} from @param {[number,number,number]} to @param {number} yaw @param {number} pitch @param {number} ms */
function fly(page, from, to, yaw, pitch, ms) {
  return page.evaluate(
    ({ from, to, yaw, pitch, ms }) => {
      const cam = /** @type {any} */ (window).__cam
      cam.real_orient(yaw, pitch)
      return new Promise((resolve) => {
        const start = performance.now()
        const step = () => {
          const t = Math.min(1, (performance.now() - start) / ms)
          cam.real_pos([
            from[0] + (to[0] - from[0]) * t,
            from[1] + (to[1] - from[1]) * t,
            from[2] + (to[2] - from[2]) * t,
          ])
          if (t < 1) requestAnimationFrame(step)
          else resolve(undefined)
        }
        requestAnimationFrame(step)
      })
    },
    { from, to, yaw, pitch, ms }
  )
}

/** The oracle: drawn columns vs the far residency mask. @param {import('@playwright/test').Page} page */
function far_mask_debug(page) {
  return page.evaluate(() => /** @type {any} */ (window).__engine._far_mask_debug())
}

test.describe.configure({ timeout: 300_000 })

test('night-watch: far mask stays pixel-clean over a 2 km multi-leg ultra traverse', async ({ browser }) => {
  await mkdir(ART, { recursive: true })
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 })
  const page = await context.newPage()

  /** @type {string[]} */
  const gpu_errors = []
  page.on('console', (msg) => {
    const t = msg.text()
    if (/webgpu|gpuvalidation|device lost|validation error/i.test(t)) gpu_errors.push(t)
  })
  page.on('pageerror', (e) => gpu_errors.push(`pageerror: ${e.message}`))

  await page.goto(`${ORIGIN}/demo/?seed=${SEED}&tier=ultra`, { waitUntil: 'domcontentloaded' })
  // §7 fail-fast (house pattern, after a real document): hardware adapter or a clean explicit failure —
  // the ci-headless project's software adapter can't run the engine (tiny buffer limits) and must not
  // produce a wall of GPUValidationErrors instead of a reason.
  const adapter = await probe_gpu_adapter(page)
  expect(adapter.ok, adapter.reason).toBe(true)
  await page.waitForFunction(() => Boolean(/** @type {any} */ (window).__engine?.get_stats), null, { timeout: 20_000 })
  await seize_camera(page)

  // Park at start, settle the near ring + let the far horizon fill.
  await page.evaluate(
    ({ pos, yaw, pitch }) => {
      const cam = /** @type {any} */ (window).__cam
      cam.real_pos(pos)
      cam.real_orient(yaw, pitch)
    },
    { pos: START, yaw: LEGS[0].yaw, pitch: PITCH }
  )
  await settle_stream(page, { min_ms: 2000, deadline_ms: 25_000 })
  // Let the far streamer build sections (idle-budget) before the first assert.
  await page.waitForFunction(
    () => Number(/** @type {any} */ (window).__engine.get_stats().far_section_count) > 0,
    null,
    { timeout: 25_000 }
  )

  /** @type {{ leg: string, drawn: number, marked: number, mismatches: number, sample: any[] }[]} */
  const report = []

  async function assert_clean(/** @type {string} */ label) {
    // Settle so no upload/evict is in flight (a transient single-frame skew would be a false positive).
    await settle_stream(page, { min_ms: 1000, deadline_ms: 15_000 })
    // Read the oracle across 3 consecutive frames — a real drift persists; a 1-frame race would not.
    let worst = { drawn: 0, marked: 0, mismatches: /** @type {any[]} */ ([]) }
    for (let i = 0; i < 3; i++) {
      const r = await far_mask_debug(page)
      if (r.mismatches.length >= worst.mismatches.length) worst = r
      await page.waitForTimeout(50)
    }
    const st = await get_stats(page)
    // Screenshot WITH the HUD visible (mandate: HUD-visible per leg) — the demo HUD is a DOM overlay
    // captured by the #canvas screenshot, so nothing to toggle; leave it shown.
    await page.locator('#canvas').screenshot({ path: `${ART}/traverse_${label}.png` })
    report.push({
      leg: label,
      drawn: worst.drawn,
      marked: worst.marked,
      mismatches: worst.mismatches.length,
      sample: worst.mismatches.slice(0, 8),
    })
    console.log(
      `[night] ${label}: drawn=${worst.drawn} marked=${worst.marked} mismatches=${worst.mismatches.length} pos=${JSON.stringify(st.camera_position)} far_sections=${st.far_section_count}`
    )
    return worst
  }

  const results = [await assert_clean('00_start')]

  let from = START
  for (let i = 0; i < LEGS.length; i++) {
    const leg = LEGS[i]
    await fly(page, from, leg.to, leg.yaw, PITCH, FLY_MS)
    from = leg.to
    results.push(await assert_clean(`0${i + 1}_leg`))
  }

  // Final: return partway back through already-visited space (exercises re-entry into evicted columns).
  await fly(page, from, [300, ALT, -230], -Math.PI / 4, PITCH, FLY_MS)
  results.push(await assert_clean('05_return'))

  console.table(report)
  await context.close()

  const total_mismatches = results.reduce((a, r) => a + r.mismatches.length, 0)
  expect(gpu_errors, `WebGPU errors during traverse: ${JSON.stringify(gpu_errors.slice(0, 3))}`).toEqual([])
  expect(
    results.every((r) => r.drawn > 0),
    'no columns were ever drawn — probe mis-set'
  ).toBe(true)
  expect(
    total_mismatches,
    `far mask left ${total_mismatches} drawn columns uncovered (the sheet). Samples: ${JSON.stringify(report.flatMap((r) => r.sample).slice(0, 12))}`
  ).toBe(0)
})
