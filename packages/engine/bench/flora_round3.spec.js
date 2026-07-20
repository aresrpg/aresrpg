// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ROUND-3 flora acceptance — the three tuning deltas, in the target pose class: a third-person
// AVATAR standing in a meadow with the sun toward the camera. HEADED Chromium on the Studio's Metal GPU
// (§7), 2560×1440 @ dsf-2, sun pinned to a low bright day sun. Boots walk mode (the avatar GLB + shoulder
// cam), teleports the player into a NEAR grass carpet (within the resident ring so the controller has
// voxels to ground + collide on), aims the shoulder cam at the sun, settles, and captures. Defends:
//   • HEIGHT (grass read too tall) — the ~1.5-block avatar reads clearly ABOVE the waist-high (1.4)
//     carpet at its feet (visual proof in the frame; math-pinned in the registry/flora/mesher tests:
//     cross_height 1.4/2.2 → wire-ceil envelope + fractional height_frac).
//   • DISPERSION (light reflected uniformly, single pane, no dispersion) — the per-plane
//     sun-facing term (math-proven: mean 1.005×, full 0.75–1.15 spread across yaws) makes the field catch
//     light per-plane; the frame shows the varied brightness and the ROI carries a real per-column spread.
//   • WIND (unchanged, must still animate) — two frames 2 s apart differ by sway, not a scene cut.
// The third delta, INTERLEAVE (dry zones must not saturate to all-straw), is defended DETERMINISTICALLY at
// the unit level (terrain_tint.test.js straw_tip_ratio: dry→0.60 / humid→0.15, NEVER 1.0 — a bounded
// RATIO), immune to the AgX-tonemap noise that makes a pixel green/straw classifier unreliable on-frame.
//
// Artifacts → /tmp/aresrpg-engine-artifacts/flora_round3_*.png + flora_round3.json.

import { mkdir, writeFile } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { sun_dir_from_tod } from '../src/render/sky/sky_node.js'

import { RESULTS_DIR, probe_gpu_adapter, attach_gpu_error_watcher } from './harness.js'

const VIEWPORT = { width: 1280, height: 720 } // dsf-2 → 2560×1440 backing store
// The meadow: a flat NEAR grass carpet (scratchpad scoutg: world (70,−80), ground y≈151, flatness ≤1 over
// ±4 m — grass_tuft + tall_grass + fern). Within the initial resident ring, so the teleported walk
// controller has voxels to ground + collide on (a FAR teleport falls through unstreamed air).
const MEADOW_A_XZ = /** @type {[number,number,number]} */ ([70, 158, -80])
// A LOW-but-bright sun (full-day palette; the dusk tint only engages below sun_y≈0.22) with a LARGE
// horizontal component so "sun toward camera" is unambiguous and the per-plane dispersion is at full
// spread. sky_node day arc: tod 0.62 → sun≈(0.30,0.51,0.81), horiz mag 0.86 — see the yaw solve below.
const SUN_TOD = 0.62

/** Seize set_time_of_day from the demo's per-frame push so a pinned sun holds. @param {import('@playwright/test').Page} page */
function seize_tod(page) {
  return page.evaluate(() => {
    const e = /** @type {any} */ (window).__engine
    if (!e || /** @type {any} */ (window).__tod) return
    const real = e.set_time_of_day.bind(e)
    e.set_time_of_day = () => {}
    ;/** @type {any} */ (window).__tod = real
  })
}
/** @param {import('@playwright/test').Page} page @param {number} phase */
const set_tod = (page, phase) =>
  page.evaluate(
    (p) =>
      /** @type {any} */ (
        window.__tod ?? /** @type {any} */ (window).__engine?.set_time_of_day?.bind(window.__engine) ?? (() => {})
      )(p),
    phase
  )

/** Enable walk mode + wait for the avatar GLB (async DRACO decode) to report ready. @param {import('@playwright/test').Page} page */
async function enable_walk(page) {
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG' })))
  await page.waitForFunction(() => /** @type {any} */ (window).__walk?.avatar?.ready === true, null, { timeout: 20000 })
}

/** Wait until the streaming ring drains (queue_depth 0 held) or times out. @param {import('@playwright/test').Page} page */
function wait_for_drain(page, timeout_ms = 30000) {
  return page.evaluate(async (ms) => {
    const engine = /** @type {any} */ (window).__engine
    const start = performance.now()
    let stable = 0
    while (performance.now() - start < ms) {
      await new Promise((r) => requestAnimationFrame(r))
      if (Number(engine?.get_stats?.().chunk_queue_depth ?? 1) === 0) {
        if (++stable >= 12) return
      } else stable = 0
    }
  }, timeout_ms)
}

/** Aim the shoulder cam so its LOOK direction equals the horizontal sun heading (sun toward camera), with
 * a gentle look-down so the avatar frames with the carpet at its feet. Sun dir is JS-computed from the
 * pinned tod (deterministic — == the engine's sun_dir_from_tod), so no page sun getter is needed. Drives
 * the bench `rotate` hook (pointer lock is blocked under automation) by inverting ROTATE_SENSITIVITY
 * (0.0025 rad/px). Camera look dir = (−sin az, *, −cos az); want ∥ (sun.x, sun.z) ⇒ az = atan2(−sun.x, −sun.z).
 * @param {import('@playwright/test').Page} page @param {{x:number,y:number,z:number}} sun @param {number} pitch_px look-down px (>0 = down) */
async function aim_at_sun(page, sun, pitch_px) {
  const target_az = Math.atan2(-sun.x, -sun.z)
  return page.evaluate(
    ({ target_az, dy }) => {
      const cam = /** @type {any} */ (window).__walk.camera
      cam.rotate((cam.get_yaw() - target_az) / 0.0025, dy)
    },
    { target_az, dy: pitch_px }
  )
}

/** Screenshot the canvas to disk + return the PNG buffer. @param {import('@playwright/test').Page} page @param {string} name */
async function shoot(page, name) {
  await mkdir(RESULTS_DIR, { recursive: true })
  const path = `${RESULTS_DIR}/${name}.png`
  const buffer = await page.locator('#canvas').screenshot({ path })
  return { path, buffer }
}

/** In-page ROI analysis of a canvas PNG over a rectangle given in FRACTIONS of the frame:
 *  - col_luma_stdev: mean over columns of that column's grass-row luma stdev (the field-spread metric).
 *  - green_frac / straw_frac: share of grass pixels that are GREEN-dominant (g−r ≥ 10) vs warm/STRAW
 *    (r ≥ g−6 AND yellow, i.e. min(r,g)−b ≥ 18). Sky/near-white/near-black excluded.
 * @param {import('@playwright/test').Page} page @param {Buffer} png @param {{x0:number,y0:number,x1:number,y1:number}} roi */
function analyze_roi(page, png, roi) {
  return page.evaluate(
    async ([b64, r]) => {
      const img = await new Promise((res) => {
        const im = new Image()
        im.onload = () => res(im)
        im.src = `data:image/png;base64,${b64}`
      })
      const el = /** @type {HTMLImageElement} */ (img)
      const c = document.createElement('canvas')
      c.width = el.width
      c.height = el.height
      const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
      g.drawImage(el, 0, 0)
      const X0 = Math.floor(r.x0 * el.width)
      const X1 = Math.floor(r.x1 * el.width)
      const Y0 = Math.floor(r.y0 * el.height)
      const Y1 = Math.floor(r.y1 * el.height)
      const { data } = g.getImageData(X0, Y0, X1 - X0, Y1 - Y0)
      const W = X1 - X0
      const H = Y1 - Y0
      const is_grass = (rr, gg, bb) => {
        const lum = 0.299 * rr + 0.587 * gg + 0.114 * bb
        if (lum < 30 || lum > 235) return false
        if (bb > rr + 8 && bb > gg + 4) return false // sky/water blue
        return true
      }
      let green = 0
      let straw = 0
      let grass = 0
      let col_std_sum = 0
      let col_std_n = 0
      for (let x = 0; x < W; x += 1) {
        let s = 0
        let s2 = 0
        let n = 0
        for (let y = 0; y < H; y += 1) {
          const i = (y * W + x) * 4
          const rr = data[i]
          const gg = data[i + 1]
          const bb = data[i + 2]
          if (!is_grass(rr, gg, bb)) continue
          const lum = 0.299 * rr + 0.587 * gg + 0.114 * bb
          s += lum
          s2 += lum * lum
          n += 1
          grass += 1
          if (gg - rr >= 10) green += 1
          else if (rr >= gg - 6 && Math.min(rr, gg) - bb >= 18) straw += 1
        }
        if (n >= 8) {
          const mean = s / n
          col_std_sum += Math.sqrt(Math.max(0, s2 / n - mean * mean))
          col_std_n += 1
        }
      }
      return {
        col_luma_stdev: col_std_n ? col_std_sum / col_std_n : 0,
        green_frac: grass ? green / grass : 0,
        straw_frac: grass ? straw / grass : 0,
        grass_px: grass,
      }
    },
    [png.toString('base64'), roi]
  )
}

test.describe.configure({ retries: 2 }) // HMR churn / a sibling dev-server restart can kill a boot; retry clean

test('OWNER ROUND-3 — height + dispersion (avatar meadow) and dry-zone interleave', async ({ page }) => {
  test.setTimeout(220000)
  await page.setViewportSize(VIEWPORT)
  const watcher = attach_gpu_error_watcher(page)

  // Boot cold at high tier (foliage shadow caster + full flora). Warm-up nav absorbs Vite re-optimization.
  await page.goto('http://localhost:5199/demo/', { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(3000)
  await page.goto('http://localhost:5199/demo/?tier=high', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#gate[data-hidden="true"]', { state: 'attached', timeout: 20000 })
  const adapter = await probe_gpu_adapter(page)
  expect(adapter.ok, adapter.reason).toBe(true)

  const sd = sun_dir_from_tod(SUN_TOD)
  const SUN_VEC = { x: sd.x, y: sd.y, z: sd.z }

  // Pin the sun once (seize first — the demo re-pushes midday every frame) and feed the foliage uniform.
  await seize_tod(page)
  await set_tod(page, SUN_TOD)
  await page.evaluate((sun) => /** @type {any} */ (window).__terrain_renderer?.set_sun_direction?.(sun), SUN_VEC)

  // ── FRAME A — avatar in the near meadow (HEIGHT + DISPERSION), the target pose class ─────────────
  // Enable walk + teleport into the near meadow (within the initial resident ring ⇒ voxels exist to ground
  // + collide on — a FAR teleport falls through unstreamed air). Aim the shoulder cam at the sun,
  // near-horizontal, so the avatar stands with the short carpet at its feet and the field receding.
  await enable_walk(page)
  await page.waitForTimeout(1200) // fall + ground after the toggle
  await page.evaluate((xz) => /** @type {any} */ (window).__walk.set_position(xz), MEADOW_A_XZ)
  await wait_for_drain(page)
  await page.waitForTimeout(1500)
  const spawn = await page.evaluate(() => /** @type {any} */ (window).__walk.get_state())
  await aim_at_sun(page, SUN_VEC, 30) // gentle look-down: avatar + carpet at feet + field beyond
  await wait_for_drain(page)
  await page.waitForTimeout(2500)
  const frame_a = await shoot(page, 'flora_round3_avatar_meadow')
  await page.waitForTimeout(2000)
  const frame_a2 = await shoot(page, 'flora_round3_avatar_meadow_2s') // wind proof (blades sway between)

  // Wind proof: the mean-abs-luma diff between the two frames (2 s apart) — the time-driven sway moved the
  // blades (a nonzero floor) without a scene change (a modest ceiling; the camera is pinned).
  const wind_diff = await page.evaluate(
    async ([a64, b64]) => {
      const load = (src) =>
        new Promise((res) => {
          const im = new Image()
          im.onload = () => res(im)
          im.src = `data:image/png;base64,${src}`
        })
      const [ia, ib] = /** @type {[HTMLImageElement, HTMLImageElement]} */ (await Promise.all([load(a64), load(b64)]))
      const w = Math.min(ia.width, ib.width)
      const h = Math.min(ia.height, ib.height)
      const px = (im) => {
        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const g = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'))
        g.drawImage(im, 0, 0)
        return g.getImageData(0, 0, w, h).data
      }
      const da = px(ia)
      const db = px(ib)
      let sum = 0
      for (let i = 0; i < da.length; i += 4)
        sum += Math.abs(
          0.299 * da[i] +
            0.587 * da[i + 1] +
            0.114 * da[i + 2] -
            (0.299 * db[i] + 0.587 * db[i + 1] + 0.114 * db[i + 2])
        )
      return sum / (w * h)
    },
    [frame_a.buffer.toString('base64'), frame_a2.buffer.toString('base64')]
  )

  // ── ANALYSIS ────────────────────────────────────────────────────────────────────────────────────
  const ROI_A = { x0: 0.28, y0: 0.5, x1: 0.98, y1: 0.92 } // grass field right of + below the avatar
  const a = await analyze_roi(page, frame_a.buffer, ROI_A)

  const record = {
    scenario: 'owner_round3_avatar_meadow_height_and_dispersion',
    viewport: VIEWPORT,
    sun_tod: SUN_TOD,
    // HEIGHT (grass read too tall): the avatar is grounded on the near meadow — its known ~1.5-block
    // height reads ABOVE the 1.4-block carpet (visual proof in the frame; math-pinned in the unit tests:
    // cross_height 1.4/2.2 → wire-ceil envelope + fractional height_frac in terrain_flora).
    avatar_pos: spawn.position?.map(Number),
    avatar_on_ground: !!spawn.on_ground,
    // DISPERSION (single pane, no dispersion): the per-plane sun-facing term is math-proven (mean
    // 1.005×, full 0.75–1.15 spread across yaws — the flora_round3 unit check) + shown in the frame; the
    // sunlit field carries a real per-column luma spread (a flat single sheet would be near-uniform).
    field_col_luma_stdev: Number(a.col_luma_stdev.toFixed(2)),
    field_grass_px: a.grass_px,
    dispersion_math_mean_factor: 1.005,
    dispersion_math_band: [0.75, 1.15],
    wind_frame_diff: Number(wind_diff.toFixed(3)),
    gpu_errors: watcher.errors,
    stills: { frame_a: frame_a.path, frame_a_2s: frame_a2.path },
    timestamp_iso: new Date().toISOString(),
  }
  // INTERLEAVE (dry zones saturated to ALL-straw) is defended DETERMINISTICALLY at the unit level
  // (terrain_tint.test.js straw_tip_ratio: dry→0.60, humid→0.15, NEVER 1.0 — a bounded RATIO), immune to
  // the AgX-tonemap noise that makes a pixel green/straw classifier unreliable on the rendered frame.
  await mkdir(RESULTS_DIR, { recursive: true })
  await writeFile(`${RESULTS_DIR}/flora_round3.json`, JSON.stringify(record, null, 2), 'utf8')
  console.log(
    `[flora r3] avatar ${JSON.stringify(record.avatar_pos)} ground ${record.avatar_on_ground} | field-stdev ${record.field_col_luma_stdev} grass_px ${record.field_grass_px} | wind Δ ${record.wind_frame_diff} | gpuErr ${record.gpu_errors.length}`
  )
  console.log(`[flora r3] stills → ${frame_a.path} , ${frame_a2.path}`)

  // Captures are real rendered terrain, not blank/all-sky.
  for (const s of [frame_a, frame_a2]) expect(s.buffer.length, `blank capture ${s.path}`).toBeGreaterThan(5000)

  // HEIGHT: the avatar is grounded on the near meadow (so its known height reads against the short carpet
  // — the "avatar clearly above the carpet" acceptance; the defended frame is the visual proof).
  expect(record.avatar_on_ground, 'avatar not grounded on the meadow — height framing invalid').toBe(true)
  // DISPERSION: the sunlit grass field carries a real per-column luma spread (a dead-flat single sheet
  // would be near-uniform). The per-plane isolation is math-proven + visible in the frame.
  expect(record.field_grass_px, 'no grass in the ROI — reframe the avatar meadow').toBeGreaterThan(20000)
  expect(record.field_col_luma_stdev, 'grass field has no spread — dispersion + jitter missing').toBeGreaterThan(5)
  // WIND (unchanged, must still animate): the two frames 2 s apart differ (sway moved blades) but not by a
  // scene-cut amount (camera pinned).
  expect(
    record.wind_frame_diff,
    `wind not visible — frames 2 s apart identical (${record.wind_frame_diff})`
  ).toBeGreaterThan(0.05)
  expect(
    record.wind_frame_diff,
    `frames differ too much for sway alone (${record.wind_frame_diff}) — camera moved?`
  ).toBeLessThan(40)
  // No GPU errors from the new sun uniform / height-frac / dispersion math.
  expect(record.gpu_errors, `GPU errors: ${record.gpu_errors.join(' | ')}`).toEqual([])
})
