// LEAVES-2X Rung 2 — near→far canopy BAND proof (dual-emit: airy sprites near, opaque early-Z cubes far).
// The design is fully built + headless-proven (mesher dual-emit parity, band math, canopy pool sizing, the
// render_hole dropped_uploads=0 seam invariant, TSL graph builds). This bench is the GPU half — it must run
// in a SMALL viewport when the machine is IDLE and no sibling headed GPU rig is live (GPU RIG LAW: :5173 down,
// ONE headed rig machine-wide, close browsers between sets, kill the rig at the end). Run headed Metal:
//   bunx playwright test canopy_band --headed
//
// WHAT IT PROVES (the RUNG2_DESIGN.md proof bar):
//   1. dropped_uploads GATE — the canopy pool absorbs the dual-emit cube shell with ZERO drops/permanent
//      drops at the MEDIUM tier over a real forest ring (the pool-budget snag the brief flagged).
//   2. WGSL compile — the new 'canopy' material lowers cleanly on real Metal (console stays fault-free);
//      headless only builds the TSL graph, never lowers it, so this is the on-device validation.
//   3. A/B STILLS near/mid/far (day + night) — near reads airy sprites, far reads the opaque cube shell,
//      the mid-band crossfades. Visual check confirms pop-free continuity at the seam.
//   4. BAND-CROSSING WALK webm (day + night) — a dolly from near→far across the 96-128 m band: no shimmer,
//      no popping, canopy silhouette continuous.
//   5. GPU-BOUND canopy cost — hide the canopy+cutout classes (set_class_visible A/B) at a canopy-facing
//      pose and read the frame delta; the honest +10-15% only shows when the frame is GPU-BOUND (bare
//      terrain is vsync-capped — RUNG2_DESIGN.md), so the number is the leaf class's marginal frame cost.

import { mkdir } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import {
  seize_camera,
  park_camera,
  fly_camera,
  settle_stream,
  get_stats,
  open_recorded_page,
  percentile,
} from './_shared.js'

const OUT = '/tmp/aresrpg-engine-artifacts/canopy_band'
// MEDIUM = the tuned tier the design measured; r6 (192 m) covers the whole 96-128 m band + far read.
const URL = '/demo/?tier=medium&load_radius=6'

// A dense broadleaf canopy near origin (the proctrees bench's dense_forest oak grove, anchor ~-107,0,
// crown ~y175). The camera sits on a line +x of the crown and looks toward -x (into the canopy), so the
// SAME trees fill the frame at every distance — the band transition is the only thing that changes.
const CANOPY = { x: -107, y: 175, z: 0 }
const LOOK_WEST = Math.PI / 2 // forward = [-sin(yaw),0,-cos(yaw)] = (-1,0,0) → looks toward -x (at the crown)
/** Camera pose `d` metres east of the crown, at crown height, aimed at it. @param {number} d */
const pose_at = (d) => /** @type {[number,number,number]} */ ([CANOPY.x + d, CANOPY.y, CANOPY.z])
// [tier band 2026-07-12] MEDIUM band is now TIER-DRIVEN off the r7 ring (224 m × 0.43/0.57 ≈ 96–128 m —
// leaf_band.js), pushed out from the old 48–80 m so the FIRST canopy the player sees stays sprite-dressed.
const NEAR_M = 60 // < 96 → pure sprites
const MID_M = 112 // band midpoint (96+128)/2 → ~50/50 crossfade
const FAR_M = 160 // > 128 → pure opaque cubes (still < r6 192 m streamed edge)

const TOD = { day: 0.25, night: 0.88 } // set_time_of_day phase: 0.25 noon-ish, 0.88 deep dusk/night

// The console must stay clean when the canopy material meshes + LOWERS TO WGSL (the on-device compile the
// headless suite can't reach): mesher faults, naga nesting, shader/pipeline, light/shadow relight, NaN.
// `pipeline` must catch real WGSL pipeline-compile FAULTS ("pipeline compilation failed",
// "createRenderPipeline …") but NOT the benign D221 success log ("[voxel] D221 pipeline pre-warm
// complete …", engine.js) — the negative lookahead excludes that exact success phrase only, so any
// other "pipeline …" line (including a hypothetical pre-warm FAILURE) still trips the gate.
const FAULT_RE =
  /mesher|occupancy|invisible|bald|shader|WGSL|naga|nesting|pipeline(?! pre-warm complete)|light|shadow|relight|NaN|device lost|boot_error|pool full|UNDERSIZED|dropped/i

/** In-page readiness predicate (self-contained — playwright serializes it): the engine + the terrain
 *  renderer pool hooks are both live. Passed straight to page.waitForFunction. @returns {boolean} */
const bench_ready = () => {
  const w = /** @type {any} */ (window)
  return !!(w.__engine && w.__terrain_renderer)
}

/** @param {import('@playwright/test').Page} page */
const set_tod = (page, phase) => page.evaluate((p) => /** @type {any} */ (window).__engine?.set_time_of_day?.(p), phase)
/** @param {import('@playwright/test').Page} page */
const pool_stats = (page) => page.evaluate(() => /** @type {any} */ (window).__terrain_renderer?.pool_stats?.() ?? {})
/** @param {import('@playwright/test').Page} page @param {string} cls @param {boolean} vis */
const set_class = (page, cls, vis) =>
  page.evaluate(({ cls, vis }) => /** @type {any} */ (window).__terrain_renderer?.set_class_visible?.(cls, vis), {
    cls,
    vis,
  })

test.describe('LEAVES-2X Rung 2 — canopy band', () => {
  test.beforeAll(async () => {
    await mkdir(OUT, { recursive: true })
  })

  // ── (1) POOL GATE + (2) WGSL compile + (3) A/B stills ────────────────────────────────────────────────
  test('pool gate (dropped_uploads=0) + WGSL clean + near/mid/far stills, day & night', async ({ browser }) => {
    const { page, finish } = await open_recorded_page(browser, 'canopy_band_stills')
    /** @type {string[]} */
    const faults = []
    page.on('console', (m) => {
      const t = m.text()
      if (FAULT_RE.test(t)) faults.push(t)
    })

    await page.goto(URL)
    await page.waitForFunction(bench_ready, null, { timeout: 60_000 })
    await seize_camera(page)
    await park_camera(page, pose_at(FAR_M), LOOK_WEST, -0.05)
    await settle_stream(page, { min_ms: 2000, deadline_ms: 30_000 })

    // (1) THE POOL GATE — the canopy pool must absorb the dual-emit cube shell with zero drops at MEDIUM.
    const ps = await pool_stats(page)
    console.log(
      `[canopy_band] pool_stats: dropped_uploads=${ps.dropped_uploads} permanent_drops=${ps.permanent_drops} pending=${ps.pending_retries}`
    )
    console.log(`[canopy_band] canopy pool: ${JSON.stringify(ps.canopy)} | cutout: ${JSON.stringify(ps.cutout)}`)
    expect(ps.dropped_uploads, 'canopy dual-emit must never overflow the pool at MEDIUM').toBe(0)
    expect(ps.permanent_drops, 'no permanently-dropped (unrendered) chunk').toBe(0)
    expect(ps.canopy?.quads ?? 0, 'the canopy pool is actually carrying the opaque cube shell').toBeGreaterThan(0)

    // (3) A/B stills at three distances × two times of day (near=sprites, far=opaque cubes, mid=crossfade).
    for (const [tod_name, phase] of Object.entries(TOD)) {
      await set_tod(page, phase)
      for (const [name, d] of /** @type {[string,number][]} */ ([
        ['near', NEAR_M],
        ['mid', MID_M],
        ['far', FAR_M],
      ])) {
        await park_camera(page, pose_at(d), LOOK_WEST, -0.05)
        await settle_stream(page, { min_ms: 800, deadline_ms: 12_000 })
        await page.screenshot({ path: `${OUT}/still_${tod_name}_${name}_${d}m.png` })
        console.log(`[canopy_band] still ${tod_name} ${name} (${d} m) captured`)
      }
    }

    // (2) WGSL compile / render fault gate — a broken canopy material would have faulted by now.
    expect(faults, `console faults (WGSL/mesher/light):\n${faults.join('\n')}`).toEqual([])
    await finish('canopy_band_stills')
    await page.close()
  })

  // ── (4) BAND-CROSSING WALK webm (day + night) ─────────────────────────────────────────────────────────
  test('band-crossing dolly is pop-free (webm, day & night)', async ({ browser }) => {
    for (const [tod_name, phase] of Object.entries(TOD)) {
      const { page, finish } = await open_recorded_page(browser, `canopy_band_walk_${tod_name}`)
      await page.goto(URL)
      await page.waitForFunction(bench_ready, null, { timeout: 60_000 })
      await seize_camera(page)
      await set_tod(page, phase)
      await park_camera(page, pose_at(NEAR_M), LOOK_WEST, -0.05)
      await settle_stream(page, { min_ms: 1500, deadline_ms: 30_000 })
      // Dolly from NEAR_M (sprites) out to FAR_M (cubes), crossing the whole 96-128 m band slowly so the
      // reviewer can watch the crossfade for shimmer/popping. 8 s at walking pace.
      await fly_camera(page, {
        from: pose_at(NEAR_M),
        to: pose_at(FAR_M),
        yaw: LOOK_WEST,
        pitch: -0.05,
        duration_ms: 8000,
      })
      await finish(`canopy_band_walk_${tod_name}`)
      await page.close()
    }
  })

  // ── (5) GPU-BOUND canopy cost (leaf-class marginal frame time) ────────────────────────────────────────
  test('leaf-class marginal frame cost (canopy+cutout A/B at a canopy-facing pose)', async ({ browser }) => {
    const { page } = await open_recorded_page(browser, 'canopy_band_cost')
    await page.goto(URL)
    await page.waitForFunction(
      () => !!(/** @type {any} */ (window.__engine && /** @type {any} */ (window).__terrain_renderer)),
      null,
      { timeout: 60_000 }
    )
    await seize_camera(page)
    // Immersed in the canopy at the band edge — the worst leaf-fill framing (a wall of leaves).
    await park_camera(page, pose_at(MID_M), LOOK_WEST, -0.05)
    await settle_stream(page, { min_ms: 2000, deadline_ms: 30_000 })

    /** Median of the engine's rolling frame_ms_p50 over ~1.5 s. @returns {Promise<number>} */
    const sample_ms = async () => {
      /** @type {number[]} */
      const ms = []
      for (let i = 0; i < 30; i++) {
        const s = await get_stats(page)
        if (typeof s.frame_ms_p50 === 'number') ms.push(s.frame_ms_p50)
        await page.waitForTimeout(50)
      }
      return ms.length ? percentile(ms, 0.5) : NaN
    }

    const full = await sample_ms()
    await set_class(page, 'canopy', false)
    await set_class(page, 'cutout', false)
    const no_leaves = await sample_ms()
    await set_class(page, 'canopy', true)
    await set_class(page, 'cutout', true)

    const delta = full - no_leaves
    console.log(
      `[canopy_band] frame-ms p50: full=${full.toFixed(2)} no_leaves=${no_leaves.toFixed(2)} leaf_cost=${delta.toFixed(2)} ms`
    )
    console.log(
      '[canopy_band] NOTE: bare terrain at MEDIUM is vsync-capped — the leaf delta is only visible when the frame is GPU-BOUND (the full game scene / contention). This isolates the leaf class marginal cost.'
    )
    // Not a hard fps assertion (vsync-capped — RUNG2_DESIGN.md): just prove the A/B toggles ran & report.
    expect(Number.isFinite(full) && Number.isFinite(no_leaves), 'frame stats available for the A/B').toBe(true)
    await page.close()
  })
})
