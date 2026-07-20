// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FROXEL STATIC-OVERLAY DETECTOR (2026-07-05 froxel rebuild) — THE gate that decides whether the
// camera-following "white static circle texture" is dead. A live bisection convicted the
// froxel VOLUME (?froxels=0 was the ONLY kill across a 3-day, 6-suspect acquittal ladder). The
// architect diagnosis pins it on the voxel-sun visibility box: a lit-vs-shadowed DIFFERENTIAL at the
// box boundary / progressive fill-frontier, painted into the air as camera-locked shells / vertical
// curtains (WHITE by day, DARK by dusk/night — visible in the calibration frames under bench/artifacts).
//
// WHY AN ON−OFF DIFFERENTIAL (and not a single ?froxels=1 sequence): the artifact is DEFINED as "what
// ?froxels=0 kills". A single-sequence "is anything screen-pinned" test can't separate the overlay from
// legit DISTANT terrain — far mountains + the fog-law haze band barely shift on screen under a 300 m
// translation either, so an optical-flow / frame-diff detector flags them too (proven: a single-sequence
// flow detector read MORE "locked" cells with froxels OFF than ON — false positives from far terrain).
// So we fly the SAME deterministic path TWICE — ?froxels=1 and ?froxels=0 — sampling at IDENTICAL camera
// POSITIONS (not wall-clock), and SUBTRACT: same seed + same pose ⇒ identical terrain/sky, so the
// per-frame ON−OFF residual is PURELY the froxel contribution. Distant terrain cancels exactly.
//
// FROM THE RESIDUAL, THE VERDICT = camera-locked structured energy. A HEALTHY froxel layer (post-fix)
// is smooth aerial haze that follows the world → its ON−OFF residual is low-contrast AND shifts with
// terrain, so it AVERAGES OUT across the flight (temporal-mean residual ≈ smooth, faint). The BAD
// overlay is screen-pinned high-contrast structure → it stays at the same screen cell every frame, so
// it SURVIVES the temporal average as a SHARP, high-magnitude, spatially-structured mean-residual. We
// measure the mean-residual's STRUCTURED energy (per-cell magnitude, high-pass filtered to ignore any
// smooth global gradient) and FAIL when a coherent region exceeds the floor — the floor is calibrated
// from the ON−OFF run itself (early flight vs late is not the control; the temporal-average IS the
// discriminator, and a clean froxel layer's structured mean-residual is near-zero by construction).
//
// RED-THEN-GREEN DUTY: this MUST fire on a build whose froxels still carry the overlay and pass when the
// overlay is gone. The instrument is self-validating: if the ON−OFF residual has no camera-locked
// structure, there is nothing to fix. Poses cover the target framings: ground-level vista at day
// (tod 0.3), dusk (tod 0.1 — a live residual framing), and night (tod 0.0).
//
// ISOLATION: ARES_DEMO_ORIGIN must point at the froxel-rebuild vite (:5291) — NEVER the main dev :5199.
// Headed Metal, ULTRA tier, big viewport (the artifact is a high/ultra froxel-tier phenomenon).

import { mkdir, writeFile } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { settle_stream } from './_shared.js'
import { DEMO_ORIGIN, probe_gpu_adapter } from './harness.js'

const ORIGIN = DEMO_ORIGIN
const SEED = 'aresrpg'
const ART = '/tmp/aresrpg-engine-artifacts/froxel_static_overlay'
const VIEWPORT = { width: 1920, height: 1080 }

// FLIGHT: a straight, constant translation sampled at FIXED POSITIONS (so ON/OFF frames align by pose).
// 12 m/s × 25 s = 300 m of ground track at y≈150 — the camera INSIDE the fog band with the voxel-sun box
// straddling terrain, where the overlay's curtains paint (at y≈190 the box sits above terrain, artifact
// faint — verified). Desert spawn surface ≈140, so 150 clears it while staying in-band.
const ALT = 150
// 300 m forward flight — the geometry with the STRONGEST artifact signal (the target framing: flying
// into the vista). Longer/side-looking variants were tried and rejected with data: a 1600 m leg dilutes
// the arcs themselves (box-recenter wander over 50 recenters smears the bands out of the temporal mean),
// and NO geometry can stop legit fog physics from being screen-static (sky/full-column veil is a function
// of ray direction + camera height — constant under ANY translation). The physics/overlay separation is
// therefore NOT motion-geometric; it is STRUCTURAL — the RIPPLE discriminator below. This geometry keeps
// the artifact's bands at full temporal-mean strength; the ripple test refuses the smooth physics fields
// (FOE veil, horizon band, sun-side glow, palette drift) that flagged every earlier instrument iteration.
const TRACK_M = 300 // total ground-track distance
const STEPS = 30 // sampled camera positions along the track (ON and OFF sample the SAME poses)
const YAW = Math.PI / 4 // the LOOK direction (fixed the whole flight)
const PITCH = -0.14 // shallow downward vista — terrain fills lower/mid frame, sky the top (curtains land here)
const DIR = /** @type {[number, number]} */ ([-Math.sin(YAW), -Math.cos(YAW)]) // fly along the view

// --- detector tunables ---------------------------------------------------------------------------
const GRID_W = 128 // coarse cell columns (artifact is blurry/low-res — cell scale, AA-immune)
const GRID_H = 72 // 16:9
const GN = GRID_W * GRID_H
// HIGH-PASS radius (cells): the mean-residual minus its radius-HP_R box-mean drops the smooth aerial-haze
// plateau (low-freq) while keeping the overlay's mid-scale band structure. ~6 ≈ 1/12 of the frame width —
// wider than the arc band spacing (so bands survive) but narrower than the haze gradient (so it's removed).
const HP_R = 6
// RIPPLE window half-width (cells) scanned along the row for band alternations.
const RIPPLE_W = 10
// Minimum |high-passed residual| for a swing to count toward an alternation (luminance, 0..255).
const RIPPLE_AMP = 3
// Minimum sign alternations across the window to call a cell RIPPLED (≥3 = at least two full bands).
// Smooth legit camera-locked fields (sun glow / grazing gradient / palette drift) are monotonic → 0-1.
const RIPPLE_MIN_ALT = 3
// OFF-leg temporal std (luminance) BELOW which a cell's content was quasi-static (FOE/far/sky) — the
// veil there inherits backdrop texture and is untestable; such cells are ineligible for the verdict.
const OFF_STD_MIN = 6
// A rippled camera-locked region must cover ≥ this many cells to FAIL — rejects isolated speckle.
// ~0.9% of the 128×72 grid; the pre-fix arcs cover several thousand cells.
const MIN_BLOB_CELLS = 80

test.describe.configure({ timeout: 600_000 })

/** Downsample an RGBA buffer to GRID_W×GRID_H cell means (in-page). */
const CELL_SAMPLER = `(data, W, H, GW, GH) => {
  const cells = new Float32Array(GW * GH * 4)
  const cw = W / GW, ch = H / GH
  for (let gy = 0; gy < GH; gy++) {
    const y0 = Math.floor(gy * ch), y1 = Math.floor((gy + 1) * ch)
    for (let gx = 0; gx < GW; gx++) {
      const x0 = Math.floor(gx * cw), x1 = Math.floor((gx + 1) * cw)
      let r = 0, g = 0, b = 0, n = 0
      for (let y = y0; y < y1; y++) {
        let i = (y * W + x0) * 4
        for (let x = x0; x < x1; x++) { r += data[i]; g += data[i + 1]; b += data[i + 2]; i += 4; n++ }
      }
      const o = (gy * GW + gx) * 4
      cells[o] = r / n; cells[o + 1] = g / n; cells[o + 2] = b / n; cells[o + 3] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / n
    }
  }
  return Array.from(cells)
}`

/** Decode a PNG screenshot (base64) → a flat [r,g,b,lum]×GN cell grid (in-page). */
async function grid_of(/** @type {import('@playwright/test').Page} */ page, /** @type {string} */ b64) {
  const url = `data:image/png;base64,${b64}`
  return page.evaluate(
    async ({ url, gw, gh, samplerSrc }) => {
      const img = new Image()
      await new Promise((res, rej) => {
        img.onload = res
        img.onerror = rej
        img.src = url
      })
      const off = document.createElement('canvas')
      off.width = img.width
      off.height = img.height
      const g = /** @type {CanvasRenderingContext2D} */ (off.getContext('2d'))
      g.drawImage(img, 0, 0)
      const { data } = g.getImageData(0, 0, img.width, img.height)

      const sampler = (0, eval)(samplerSrc)
      return sampler(data, img.width, img.height, gw, gh)
    },
    { url, gw: GRID_W, gh: GRID_H, samplerSrc: CELL_SAMPLER }
  )
}

/** Connected-component labelling (4-neighbour) over a boolean cell mask → components (index arrays). */
function components(/** @type {boolean[]} */ mask) {
  const seen = new Uint8Array(GN)
  /** @type {number[][]} */
  const comps = []
  for (let s = 0; s < GN; s++) {
    if (!mask[s] || seen[s]) continue
    const stack = [s]
    seen[s] = 1
    /** @type {number[]} */
    const comp = []
    while (stack.length) {
      const c = /** @type {number} */ (stack.pop())
      comp.push(c)
      const cx = c % GRID_W
      const cy = (c - cx) / GRID_W
      for (const nb of [
        cx > 0 ? c - 1 : -1,
        cx < GRID_W - 1 ? c + 1 : -1,
        cy > 0 ? c - GRID_W : -1,
        cy < GRID_H - 1 ? c + GRID_W : -1,
      ])
        if (nb >= 0 && mask[nb] && !seen[nb]) {
          seen[nb] = 1
          stack.push(nb)
        }
    }
    comps.push(comp)
  }
  return comps
}

/** Prepare a fresh page at ?froxels=<flag>, wait until drivable. */
async function open_page(/** @type {import('@playwright/test').Browser} */ browser, /** @type {string} */ froxel_flag) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  const page = await context.newPage()
  /** @type {string[]} */
  const gpu_errors = []
  page.on('console', (msg) => {
    const t = msg.text()
    if (/webgpu|gpuvalidation|device lost|validation error/i.test(t)) gpu_errors.push(t)
  })
  page.on('pageerror', (e) => gpu_errors.push(`pageerror: ${e.message}`))
  // &clouds=0 on BOTH legs — the differential REQUIRES wall-clock determinism, and the cloud deck is
  // the one non-froxel system that drifts with real time: the ON and OFF legs run minutes apart, so at
  // pose k they see DIFFERENT cloud states and the lit deck (day/dusk) leaves a structured mismatch
  // band that reads as a fake "overlay" (proven: an identical ~330-cell day blob across four different
  // froxel builds AND the pre-fix carrier — invariant because it was never froxel structure; night,
  // with the deck unlit, read clean). The gate's subject is THE FROXEL LAYER; clouds are orthogonal.
  // ARES_FROXEL_EXTRA appends further flags to both pages (e.g. '&bloom=0') for isolation A/Bs.
  const extra = process.env.ARES_FROXEL_EXTRA ?? ''
  await page.goto(`${ORIGIN}/demo/?seed=${SEED}&tier=ultra&clouds=0&froxels=${froxel_flag}${extra}`, {
    waitUntil: 'domcontentloaded',
  })
  const adapter = await probe_gpu_adapter(page)
  expect(adapter.ok, adapter.reason).toBe(true)
  await page.waitForFunction(
    () =>
      typeof (/** @type {any} */ (window).__engine?.set_camera_orientation) === 'function' &&
      typeof (/** @type {any} */ (window).__engine?.set_camera_position) === 'function' &&
      typeof (/** @type {any} */ (window).__engine?.get_stats) === 'function',
    null,
    { timeout: 20_000 }
  )
  return { context, page, gpu_errors }
}

/** Neutralize the demo's per-frame camera push + set tod (one closure so bound refs never cross an
 *  evaluate boundary — a stale cross-context ref was a "not a function" ghost). Then park + settle. */
async function park_and_settle(/** @type {import('@playwright/test').Page} */ page, /** @type {number} */ tod) {
  const start = /** @type {[number, number, number]} */ ([70, ALT, 70])
  await page.evaluate(
    ({ start, yaw, pitch, tod }) => {
      const w = /** @type {any} */ (window)
      const engine = w.__engine
      if (!w.__fx_real) {
        w.__fx_real = {
          pos: engine.set_camera_position.bind(engine),
          orient: engine.set_camera_orientation.bind(engine),
        }
        engine.set_camera_position = () => {}
        engine.set_camera_orientation = () => {}
      }
      w.__fx_real.pos(start)
      w.__fx_real.orient(yaw, pitch)
      engine.set_time_of_day(tod)
    },
    { start, yaw: YAW, pitch: PITCH, tod }
  )
  await settle_stream(page, { min_ms: 2500, deadline_ms: 30_000 })
  // Let the progressive voxel-sun fill + froxel integrate CONVERGE before flying (can take up to 10s to
  // appear) so the overlay is fully present when the flight starts. Camera fixed = pure artifact settling.
  await page.waitForTimeout(11_000)
  await page.evaluate(() => {
    for (const s of ['.lil-gui', '#hud'])
      for (const el of document.querySelectorAll(s)) /** @type {HTMLElement} */ (el).style.visibility = 'hidden'
  })
}

/**
 * Fly the fixed track sampling at STEPS identical camera POSITIONS. At each position we jump the camera,
 * settle the stream, let the froxel volume re-converge briefly, then screenshot → coarse grid. Position-
 * (not time-) sampling guarantees the ON and OFF passes see the SAME pose at frame k, so they subtract.
 * @returns {Promise<{ grids: number[][], last_b64: string }>}
 */
async function fly_and_sample(/** @type {import('@playwright/test').Page} */ page) {
  /** @type {number[][]} */
  const grids = []
  let last_b64 = ''
  for (let k = 0; k < STEPS; k++) {
    const d = (k / (STEPS - 1)) * TRACK_M
    const pos = /** @type {[number, number, number]} */ ([70 + DIR[0] * d, ALT, 70 + DIR[1] * d])
    await page.evaluate(
      ({ pos, yaw, pitch }) => {
        const w = /** @type {any} */ (window)
        w.__fx_real.pos(pos)
        w.__fx_real.orient(yaw, pitch)
      },
      { pos, yaw: YAW, pitch: PITCH }
    )
    // Settle the near ring so terrain is fully drawn at this pose (else ON/OFF differ on stream state).
    await settle_stream(page, { min_ms: 400, deadline_ms: 8000 })
    // Let the voxel-sun box re-center + the froxel grid re-integrate for this pose so the overlay is at
    // its steady, fully-converged screen position (the camera-locked state that's visible, not a transient).
    await page.waitForTimeout(700)
    const b64 = (await page.locator('#canvas').screenshot()).toString('base64')
    last_b64 = b64
    grids.push(await grid_of(page, b64))
  }
  return { grids, last_b64 }
}

/** signed box-mean of a field (radius r) — the low-pass used to strip the smooth haze plateau. */
function box_mean(/** @type {Float64Array} */ f, /** @type {number} */ radius) {
  const out = new Float64Array(GN)
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++) {
      let sum = 0,
        n = 0
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const yy = y + dy,
            xx = x + dx
          if (yy < 0 || yy >= GRID_H || xx < 0 || xx >= GRID_W) continue
          sum += f[yy * GRID_W + xx]
          n++
        }
      out[y * GRID_W + x] = sum / n
    }
  return out
}

/** box-mean of |field| (radius r) — smooths single-cell AA speckle out of the magnitude field. */
function box_mean_abs(/** @type {Float64Array} */ f, /** @type {number} */ radius) {
  const out = new Float64Array(GN)
  for (let y = 0; y < GRID_H; y++)
    for (let x = 0; x < GRID_W; x++) {
      let sum = 0,
        n = 0
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const yy = y + dy,
            xx = x + dx
          if (yy < 0 || yy >= GRID_H || xx < 0 || xx >= GRID_W) continue
          sum += Math.abs(f[yy * GRID_W + xx])
          n++
        }
      out[y * GRID_W + x] = sum / n
    }
  return out
}

/**
 * The verdict math: given the ON and OFF aligned grid sequences, compute the temporal-mean ON−OFF
 * luminance residual, high-pass it (subtract its local box-mean to drop any smooth global haze gradient),
 * and flag cells that are camera-locked AND RIPPLED (band-alternating — see the RIPPLE DISCRIMINATOR).
 * Returns diagnostics + the flagged mask.
 */
function detect(/** @type {number[][]} */ on, /** @type {number[][]} */ off) {
  const N = Math.min(on.length, off.length)
  // Per-cell temporal mean of the SIGNED ON−OFF luminance residual (the froxel contribution over the flight).
  const mean_res = new Float64Array(GN)
  for (let k = 0; k < N; k++) {
    const a = on[k]
    const b = off[k]
    for (let s = 0; s < GN; s++) mean_res[s] += a[s * 4 + 3] - b[s * 4 + 3]
  }
  for (let s = 0; s < GN; s++) mean_res[s] /= N
  // OFF-LEG MOTION ELIGIBILITY — a cell is only JUDGEABLE where the world genuinely SWEPT underneath.
  // Where the OFF-leg content is quasi-static (FOE terrain ahead, far skyline, open sky — temporal std
  // below OFF_STD_MIN), the veil residual inherits the BACKDROP's own texture (veil × dark-tree vs
  // bright-sand differs), and that camera-locked scene texture ripples like an overlay (the last false
  // red). Where content swept, the backdrop cancels out of the temporal mean BY CONSTRUCTION and only
  // the froxel layer's own screen-pinned structure can survive — the honest test surface. The arcs cover
  // the swept terrain band massively, so red sensitivity is preserved (verified).
  const off_std = new Float64Array(GN)
  {
    const sum = new Float64Array(GN)
    const sum2 = new Float64Array(GN)
    for (let k = 0; k < N; k++) {
      const b = off[k]
      for (let s = 0; s < GN; s++) {
        const v = b[s * 4 + 3]
        sum[s] += v
        sum2[s] += v * v
      }
    }
    for (let s = 0; s < GN; s++) {
      const m = sum[s] / N
      off_std[s] = Math.sqrt(Math.max(0, sum2[s] / N - m * m))
    }
  }
  // Subtract the GLOBAL MEDIAN residual: a uniform froxel tint (the whole frame a hair brighter/darker)
  // is acceptable atmosphere, not an overlay — only SPATIAL VARIATION in the persistent residual (the
  // arcs/curtains that sit at specific screen cells) is the artifact. Median (not mean) so the arcs
  // themselves don't bias the baseline.
  const med = (() => {
    const s = Array.from(mean_res).sort((a, b) => a - b)
    return s[Math.floor(GN / 2)]
  })()
  for (let s = 0; s < GN; s++) mean_res[s] -= med
  // ROW-MEDIAN SUBTRACTION — the principled aerial-perspective exclusion. What legitimately SURVIVES the
  // temporal average of a correct fog layer is camera-locked but strictly ROW-shaped: the haze a ray
  // accumulates depends (at fixed pitch over a flight) on its screen ELEVATION — longest path at the
  // horizon row, less above/below — and is ~constant ALONG each row (proven: post-donut-kill the flagged
  // residual collapsed to a full-width band hugging the horizon = textbook aerial perspective, present in
  // any correct volumetric). THE TARGET overlay (arcs / vertical curtains / voxel ghosts) VARIES ALONG
  // rows by construction. Subtracting each row's median keeps exactly the row-VARYING camera-locked
  // signal (the artifact) and cancels the row-shaped physics. Limitation (accepted + documented): an
  // overlay that is perfectly row-constant would be excused — no such term exists (all the convicted
  // structures are radial/vertical), and the physics band would otherwise permanently red the gate.
  for (let y = 0; y < GRID_H; y++) {
    const row = []
    for (let x = 0; x < GRID_W; x++) row.push(mean_res[y * GRID_W + x])
    row.sort((a, b) => a - b)
    const rmed = row[Math.floor(GRID_W / 2)]
    for (let x = 0; x < GRID_W; x++) mean_res[y * GRID_W + x] -= rmed
  }
  // Then HIGH-PASS: subtract a medium box-mean (radius HP_R) to drop any remaining smooth plateau,
  // keeping the mid-scale band structure the overlay is made of; small smooth kills AA speckle.
  const lowpass = box_mean(mean_res, HP_R)
  const hp = new Float64Array(GN)
  for (let s = 0; s < GN; s++) hp[s] = mean_res[s] - lowpass[s]
  const struct = box_mean_abs(hp, 1)
  // ── THE RIPPLE DISCRIMINATOR ────────────────────────────────────────────────────────────────────
  // For SKY / full-column pixels, ANY correct volumetric fog is screen-static under pure translation:
  // the veil there is a function of RAY DIRECTION + camera height only (grazing-angle thickness, the
  // sun-side HG glow by day, the ambient sky-palette azimuthal drift by night), all constant over the
  // flight — measured: a smooth camera-locked field flags in BOTH the pre-fix and fixed builds at every
  // tod. So "camera-locked" alone cannot define the artifact; what set the target overlay apart is its
  // OSCILLATORY band structure (nested arcs / staircase ripples). A cell is flagged only when its
  // neighbourhood is camera-locked AND RIPPLED: scanning the high-passed persistent residual along the
  // row across ±RIPPLE_W cells, the signal must ALTERNATE sign ≥ RIPPLE_MIN_ALT times with amplitude ≥
  // RIPPLE_AMP on each swing (≥2 full bands). Smooth legit fields are monotonic over that window (0-1
  // alternations); the arcs' bands alternate 3+ times. This is the mandate's "coherent region" made
  // precise: coherent = a contiguous blob of band-structured, screen-pinned persistent residual.
  /** @type {boolean[]} */
  const flagged = new Array(GN).fill(false)
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      const x0 = Math.max(0, x - RIPPLE_W)
      const x1 = Math.min(GRID_W - 1, x + RIPPLE_W)
      let alternations = 0
      let last_sign = 0
      for (let xx = x0; xx <= x1; xx++) {
        const v = hp[y * GRID_W + xx]
        if (Math.abs(v) < RIPPLE_AMP) continue
        const sign = v > 0 ? 1 : -1
        if (last_sign !== 0 && sign !== last_sign) alternations++
        last_sign = sign
      }
      flagged[y * GRID_W + x] = alternations >= RIPPLE_MIN_ALT && off_std[y * GRID_W + x] >= OFF_STD_MIN
    }
  }
  const comps = components(flagged)
  comps.sort((p, q) => q.length - p.length)
  const biggest = comps[0] ?? []
  /** @type {boolean[]} */
  const blob_mask = new Array(GN).fill(false)
  for (const c of biggest) blob_mask[c] = true
  let struct_max = 0,
    struct_p95 = 0
  const sorted = Array.from(struct).sort((a, b) => a - b)
  struct_max = sorted[GN - 1]
  struct_p95 = sorted[Math.floor(GN * 0.95)]
  return {
    N,
    flagged_cells: flagged.filter(Boolean).length,
    biggest_blob: biggest.length,
    struct_max: +struct_max.toFixed(2),
    struct_p95: +struct_p95.toFixed(2),
    mean_res_absmax: +Math.max(...Array.from(mean_res, Math.abs)).toFixed(2),
    blob_mask,
    hp, // the high-passed persistent residual field — dumped as an evidence heatmap per run
  }
}

/** Render the hp field as a heatmap PNG (base64, ×10 upscale; red=positive, blue=negative), in-page. */
async function hp_png(/** @type {import('@playwright/test').Page} */ page, /** @type {Float64Array} */ hp) {
  return page.evaluate(
    ({ hp, gw, gh }) => {
      const scale = 10
      const off = document.createElement('canvas')
      off.width = gw * scale
      off.height = gh * scale
      const g = /** @type {CanvasRenderingContext2D} */ (off.getContext('2d'))
      let amax = 0
      for (const v of hp) amax = Math.max(amax, Math.abs(v))
      for (let y = 0; y < gh; y++)
        for (let x = 0; x < gw; x++) {
          const v = hp[y * gw + x]
          const t = Math.abs(v) / (amax || 1)
          g.fillStyle =
            v >= 0
              ? `rgb(${Math.round(255 * t)},${Math.round(90 * t)},0)`
              : `rgb(0,${Math.round(90 * t)},${Math.round(255 * t)})`
          g.fillRect(x * scale, y * scale, scale, scale)
        }
      // annotate the normalization so heatmaps are comparable across runs
      g.fillStyle = 'white'
      g.font = '24px monospace'
      g.fillText(`amax=${amax.toFixed(1)}`, 12, 30)
      return off.toDataURL('image/png').split(',')[1]
    },
    { hp: Array.from(hp), gw: GRID_W, gh: GRID_H }
  )
}

/** Paint the flagged blob magenta over a reference frame → evidence PNG (base64), in-page. */
async function highlight_png(
  /** @type {import('@playwright/test').Page} */ page,
  /** @type {string} */ b64,
  /** @type {boolean[]} */ blob_mask
) {
  const url = `data:image/png;base64,${b64}`
  return page.evaluate(
    async ({ url, blob_mask, gw, gh }) => {
      const img = new Image()
      await new Promise((res, rej) => {
        img.onload = res
        img.onerror = rej
        img.src = url
      })
      const off = document.createElement('canvas')
      off.width = img.width
      off.height = img.height
      const g = /** @type {CanvasRenderingContext2D} */ (off.getContext('2d'))
      g.drawImage(img, 0, 0)
      g.fillStyle = 'rgba(255,0,255,0.5)'
      const cw = img.width / gw,
        ch = img.height / gh
      for (let s = 0; s < blob_mask.length; s++) {
        if (!blob_mask[s]) continue
        const cx = s % gw
        g.fillRect(cx * cw, ((s - cx) / gw) * ch, cw, ch)
      }
      return off.toDataURL('image/png').split(',')[1]
    },
    { url, blob_mask, gw: GRID_W, gh: GRID_H }
  )
}

/**
 * One tod: fly ?froxels=1 and ?froxels=0 over the same track, subtract, detect, write evidence.
 * @param {import('@playwright/test').Browser} browser @param {number} tod @param {string} label
 */
async function run_pair(browser, tod, label) {
  // ARES_FROXEL_ON_FLAG overrides the "ON" pass flag — set to '0' for the NEGATIVE CONTROL (off-vs-off
  // ⇒ residual ≈ 0, proving the differential math has no harness bias). Default '1' (the real gate).
  const on_h = await open_page(browser, process.env.ARES_FROXEL_ON_FLAG ?? '1')
  await park_and_settle(on_h.page, tod)
  const on = await fly_and_sample(on_h.page)

  const off_h = await open_page(browser, '0')
  await park_and_settle(off_h.page, tod)
  const off = await fly_and_sample(off_h.page)

  const r = detect(on.grids, off.grids)

  await mkdir(ART, { recursive: true })
  const hi = await highlight_png(on_h.page, on.last_b64, r.blob_mask)
  await writeFile(`${ART}/${label}_highlight.png`, Buffer.from(hi, 'base64'))
  await writeFile(`${ART}/${label}_on_last.png`, Buffer.from(on.last_b64, 'base64'))
  await writeFile(`${ART}/${label}_off_last.png`, Buffer.from(off.last_b64, 'base64'))
  // the high-passed persistent-residual heatmap — the field the verdict is computed on (evidence).
  const hpimg = await hp_png(on_h.page, r.hp)
  await writeFile(`${ART}/${label}_hp.png`, Buffer.from(hpimg, 'base64'))
  const summary = {
    label,
    tod,
    steps: r.N,
    grid: [GRID_W, GRID_H],
    ripple: { w: RIPPLE_W, amp: RIPPLE_AMP, min_alt: RIPPLE_MIN_ALT },
    min_blob_cells: MIN_BLOB_CELLS,
    struct_max: r.struct_max,
    struct_p95: r.struct_p95,
    mean_res_absmax: r.mean_res_absmax,
    flagged_cells: r.flagged_cells,
    biggest_blob: r.biggest_blob,
    verdict: r.biggest_blob >= MIN_BLOB_CELLS ? 'STATIC-OVERLAY DETECTED' : 'clean',
  }
  await writeFile(`${ART}/${label}_summary.json`, JSON.stringify(summary, null, 2))
  console.log(`[froxel-detector] ${JSON.stringify(summary)}`)

  const gpu_errors = [...on_h.gpu_errors, ...off_h.gpu_errors]
  await on_h.context.close()
  await off_h.context.close()
  return { biggest: r.biggest_blob, summary, gpu_errors }
}

/** @param {number} tod @param {string} label */
function make_test(tod, label) {
  test(`froxel static-overlay detector @ ${label} (tod ${tod})`, async ({ browser }) => {
    const { biggest, gpu_errors } = await run_pair(browser, tod, label)
    expect(gpu_errors, `WebGPU errors: ${JSON.stringify(gpu_errors.slice(0, 3))}`).toEqual([])
    const expect_artifact = process.env.ARES_FROXEL_EXPECT === 'artifact'
    if (expect_artifact) {
      // INSTRUMENT CALIBRATION (pre-fix): the ON−OFF residual MUST carry a camera-locked structured blob,
      // else the detector is blind and a post-fix pass would be meaningless.
      expect(
        biggest,
        `INSTRUMENT BLIND: the ON−OFF residual has no camera-locked structured blob (biggest ${biggest} < ${MIN_BLOB_CELLS}) — the detector failed to catch the known overlay. See ${ART}/${label}_highlight.png`
      ).toBeGreaterThanOrEqual(MIN_BLOB_CELLS)
    } else {
      // POST-FIX gate: the froxel layer adds NO camera-locked structured overlay (only smooth world-
      // following haze, which averages out of the temporal-mean residual).
      expect(
        biggest,
        `STATIC OVERLAY: the froxel ON−OFF residual has a ${biggest}-cell camera-locked structured blob (≥${MIN_BLOB_CELLS}) — the overlay survives. Highlight: ${ART}/${label}_highlight.png`
      ).toBeLessThan(MIN_BLOB_CELLS)
    }
  })
}

make_test(0.25, 'day') // the target day framing (tod 0.25, ground-level vista)
make_test(0.1, 'dusk') // a live residual framing (ground-level vista into the dusk sky)
make_test(0.0, 'night')
