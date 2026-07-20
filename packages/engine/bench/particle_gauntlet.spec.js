// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE TORMENTOR GAUNTLET (S-AMBIENCE, the named re-enable gate, automated). The ambient particle DRAW
// was disabled for release (atmosphere.js:726) after the camera-following field read as CONCENTRIC ARC-SHELLS
// / "a huge low-res circle following me" — root cause: semi-transparent SQUARE sprites (no round soft falloff)
// accumulating alpha in the camera-centred wrap-box. render/particles.js now wires the ROUND radial falloff
// (sprite_falloff / colorNode Fn). This gauntlet is the re-enable requirement, mechanised:
//
//   (1) DENSE-FIELD STILLS at HIS FRAMING CLASSES (pose-pin: front / asym / far-moved / altitude) with a
//       RADIAL-HISTOGRAM assert — brightness binned by distance from screen-centre must be SMOOTH (no ring
//       oscillation): a shell = local peaks + high 2nd-derivative roughness. Flat/monotonic ⇒ no arc-shells.
//   (2) A NON-VACUOUS GUARD — the SAME metric is run on a synthetic concentric-ring image and MUST flag it,
//       so a green still-gate can never be "the assert measures nothing".
//   (3) A 20s MOVING-CAMERA SOAK webm (the white-halo law's proof shape) — the camera translates + sweeps its
//       look so a camera-glued artifact would ride dead-centre; the reviewer's eyes on the real pixels.
//
// Standalone probe (demo/particles_probe.html) on its own WebGPURenderer — the live engine's ambient draw is
// count-0'd for release and its renderer isn't exposed to the bench (particle_kinds.spec.js rationale). Worst
// case by design: opacity 0.95 + a dense field = maximum alpha accumulation, the strongest possible shell test.
//
// Run: `bunx playwright test particle_gauntlet` (headed Metal). Artifacts → /tmp/aresrpg-engine-artifacts.

import { mkdir } from 'node:fs/promises'

import { test, expect } from '@playwright/test'

import { DEMO_ORIGIN } from './harness.js'
import { open_recorded_page } from './_shared.js'

const OUT = '/tmp/aresrpg-engine-artifacts/particle_gauntlet'
const BINS = 28 // radial bins from screen-centre to corner
const DENSE = 5000 // near PARTICLE_MAX (6000) — a saturated field
const luma = (hex) => 0.299 * ((hex >> 16) & 255) + 0.587 * ((hex >> 8) & 255) + 0.114 * (hex & 255)

// ── ACCEPTANCE THRESHOLD — the RADIAL-vs-ANGULAR roughness RATIO ─────────────────────────────────
// A sparse field of discrete dots has real per-bin Poisson noise, so an ABSOLUTE radial roughness flags noise,
// not shells (proven: the round-sprite field screenshots as a clean starfield yet a single-frame radial profile
// reads rough). The HONEST discriminator: a CONCENTRIC shell is radially structured but AZIMUTHALLY UNIFORM (a
// full ring) — random noise is structured in NEITHER. So bin the SAME frame two ways: RADIAL (equal-AREA rings,
// so every bin holds ≈equal pixels ⇒ equal noise floor) and ANGULAR (wedges). Their 2nd-derivative roughness is
// the field's own noise floor; a uniform/noisy field has ratio ≈ 1, a shelly field spikes the RADIAL roughness
// far above the angular control. The ANGULAR profile auto-calibrates to the field's sparsity — no magic absolute.
const RATIO_MAX = 2.4 // radial_roughness / angular_roughness (uniform ≈ 1; concentric shells ≫ this). From evidence + margin.
const PEAK_DELTA = 0.14 // normalised prominence for a bin to count as a ring peak (logged, not asserted)

const FRAMES = ['front', 'asym', 'moved', 'altitude'] // the pose-pin framing classes (probe FRAMES map)
/** The dense fields under test: `ambient` = the exact TORMENTOR culprit (mixed mote+leaf); `snow` = the
 *  brightest/densest kind against a lit sky (the strongest visual accumulation case). */
const KINDS = [
  { kind: 'ambient', bg: 0x14140f, label: 'mixed dust+leaf (the TORMENTOR field)' },
  { kind: 'snow', bg: 0x8a99a8, label: 'dense white snow over a lit sky' },
]

/**
 * Decode the frame in-page and return TWO brightness profiles of the SAME pixels: RADIAL (equal-AREA rings
 * from screen-centre, so each bin holds ≈equal pixels ⇒ equal noise floor — no inner-bin bias) and ANGULAR
 * (equal wedges). A concentric shell writes a bump into RADIAL only; sparse noise scatters into both equally.
 * Each is mean(luma − bg) per bin (only brighter-than-bg pixels count — the particles). @param {import('@playwright/test').Page}
 * page @param {string} data_url @param {number} bg_luma @returns {Promise<{ radial:number[], angular:number[] }>}
 */
async function profiles(page, data_url, bg_luma) {
  return page.evaluate(
    async ({ url, bg_luma, bins }) => {
      const img = new Image()
      await new Promise((res, rej) => {
        img.onload = res
        img.onerror = rej
        img.src = url
      })
      const cv = document.createElement('canvas')
      cv.width = img.width
      cv.height = img.height
      const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'))
      g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, img.width, img.height).data
      const { width, height } = img
      const cx = width / 2
      const cy = height / 2
      const maxR = Math.hypot(cx, cy)
      const rs = new Float64Array(bins)
      const rc = new Float64Array(bins)
      const as = new Float64Array(bins)
      const ac = new Float64Array(bins)
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4
          const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
          const above = l - bg_luma > 0 ? l - bg_luma : 0
          const rn = Math.hypot(x - cx, y - cy) / maxR // [0,1]
          const rb = Math.min(bins - 1, Math.floor(rn * rn * bins)) // r² ⇒ EQUAL-AREA rings
          rs[rb] += above
          rc[rb] += 1
          const ang = (Math.atan2(y - cy, x - cx) + Math.PI) / (2 * Math.PI) // [0,1)
          const ab = Math.min(bins - 1, Math.floor(ang * bins))
          as[ab] += above
          ac[ab] += 1
        }
      }
      const radial = []
      const angular = []
      for (let b = 0; b < bins; b += 1) {
        radial.push(rc[b] ? rs[b] / rc[b] : 0)
        angular.push(ac[b] ? as[b] / ac[b] : 0)
      }
      return { radial, angular }
    },
    { url: data_url, bg_luma, bins: BINS }
  )
}

/** @param {number[]} p @returns {{ rough:number, norm:number[], peaks:number }} normalised 2nd-derivative
 *  roughness + interior ring-peak count of a profile (normalised by its own mean). */
function roughness_of(p) {
  const mean = p.reduce((a, b) => a + b, 0) / (p.length || 1)
  const norm = p.map((v) => v / (mean || 1))
  let rough = 0
  let m = 0
  let peaks = 0
  for (let i = 1; i < norm.length - 1; i += 1) {
    rough += Math.abs(norm[i - 1] - 2 * norm[i] + norm[i + 1])
    m += 1
    if (norm[i] > norm[i - 1] && norm[i] > norm[i + 1] && norm[i] - Math.min(norm[i - 1], norm[i + 1]) > PEAK_DELTA)
      peaks += 1
  }
  return { rough: rough / (m || 1), norm, peaks }
}

/**
 * The shell metric: RADIAL roughness ÷ ANGULAR roughness. The angular profile is the SAME field's noise floor
 * (equal-population bins) — so ratio ≈ 1 for a uniform/noisy field, and a concentric-shell field spikes the
 * radial roughness far above the angular control. @param {number[]} radial @param {number[]} angular
 * @returns {{ ratio:number, rr:number, ra:number, peaks:number, radialNorm:number[] }}
 */
function shell_metric(radial, angular) {
  const R = roughness_of(radial)
  const A = roughness_of(angular)
  return { ratio: R.rough / Math.max(A.rough, 1e-4), rr: R.rough, ra: A.rough, peaks: R.peaks, radialNorm: R.norm }
}

// ── (1) DENSE-FIELD STILLS + RADIAL-HISTOGRAM at the target framing classes ────────────────────────
for (const spec of KINDS) {
  for (const frame of FRAMES) {
    test(`no arc-shells — ${spec.kind} @ ${frame} framing (${spec.label})`, async ({ page }) => {
      test.setTimeout(90_000)
      await mkdir(OUT, { recursive: true })

      /** @type {string[]} */
      const gpu_errors = []
      page.on('console', (msg) => {
        if (msg.type() === 'error' && /webgpu|gpuvalidation|device lost|renderpass|createtexture/i.test(msg.text()))
          gpu_errors.push(msg.text())
      })
      page.on('pageerror', (e) => gpu_errors.push(String(e)))

      const url = new URL(`${DEMO_ORIGIN}/demo/particles_probe.html`)
      url.searchParams.set('kind', spec.kind)
      url.searchParams.set('count', String(DENSE))
      url.searchParams.set('frame', frame)
      await page.goto(url.toString())
      await page.waitForFunction(
        () => Boolean(/** @type {any} */ (window).__probe_ready) || Boolean(/** @type {any} */ (window).__probe_err),
        null,
        { timeout: 40_000 }
      )
      const err = await page.evaluate(() => /** @type {any} */ (window).__probe_err ?? null)
      expect(err, `probe init error for ${spec.kind}@${frame}`).toBeNull()
      await page.waitForTimeout(2_200) // field populates + gust breathes

      const png_path = `${OUT}/${spec.kind}_${frame}.png`
      const shot = await page.screenshot({ path: png_path })
      const data_url = `data:image/png;base64,${shot.toString('base64')}`
      const { radial, angular } = await profiles(page, data_url, luma(spec.bg))
      const { ratio, rr, ra, peaks, radialNorm } = shell_metric(radial, angular)

      console.log(
        `[gauntlet] ${spec.kind}@${frame}: ratio=${ratio.toFixed(2)} (radial ${rr.toFixed(3)} / angular ${ra.toFixed(
          3
        )}) peaks=${peaks} radial=[${radialNorm.map((n) => n.toFixed(2)).join(',')}] → ${png_path}`
      )
      expect(gpu_errors, `${spec.kind}@${frame} GPU errors:\n${gpu_errors.join('\n')}`).toEqual([])
      // the field must be visibly present (a blank frame has no signal — never a pass on nothing).
      expect(
        radialNorm.some((n) => n > 0.2),
        `${spec.kind}@${frame} rendered a blank/near-empty field`
      ).toBe(true)
      // no camera-concentric structure: radial roughness must not spike above the field's own angular noise floor.
      expect(ratio, `${spec.kind}@${frame} radial roughness ≫ angular (concentric arc-shells)`).toBeLessThan(RATIO_MAX)
    })
  }
}

// ── (2) NON-VACUOUS GUARD — the metric MUST flag a synthetic concentric-ring image ──────────────────
test('radial shell-metric flags a synthetic ring pattern (the gate is not vacuous)', async ({ page }) => {
  await page.goto(`${DEMO_ORIGIN}/demo/particles_probe.html?kind=snow&count=10`) // any page with a canvas/DOM
  const data_url = await page.evaluate((bins) => {
    const cv = document.createElement('canvas')
    cv.width = 640
    cv.height = 480
    const g = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'))
    g.fillStyle = '#000'
    g.fillRect(0, 0, 640, 480)
    const cx = 320
    const cy = 240
    const maxR = Math.hypot(cx, cy)
    const im = g.getImageData(0, 0, 640, 480)
    for (let y = 0; y < 480; y += 1) {
      for (let x = 0; x < 640; x += 1) {
        const r = Math.hypot(x - cx, y - cy) / maxR
        // `bins`/2 bright concentric rings — the exact artifact class the field must NOT show.
        const v = Math.max(0, Math.cos(r * Math.PI * bins)) * 255
        const i = (y * 640 + x) * 4
        im.data[i] = im.data[i + 1] = im.data[i + 2] = v
        im.data[i + 3] = 255
      }
    }
    g.putImageData(im, 0, 0)
    return cv.toDataURL('image/png')
  }, BINS)
  const { radial, angular } = await profiles(page, data_url, 0)
  const { ratio, rr, ra, peaks } = shell_metric(radial, angular)
  console.log(
    `[gauntlet] SELF-CHECK synthetic rings: ratio=${ratio.toFixed(2)} (radial ${rr.toFixed(3)} / angular ${ra.toFixed(
      3
    )}) peaks=${peaks} — MUST exceed the gate (${RATIO_MAX})`
  )
  // concentric rings write strong RADIAL roughness with a flat ANGULAR control ⇒ a ratio far past the gate.
  expect(ratio, 'metric should flag concentric rings (radial ≫ angular)').toBeGreaterThan(RATIO_MAX * 2)
  expect(peaks, 'metric should count multiple ring peaks').toBeGreaterThanOrEqual(3)
})

// ── (3) 20s MOVING-CAMERA SOAK — no camera-glued structure (webm proof) ─────────────────────────────
test('20s moving-camera soak on the dense field — no camera-glued shell (webm)', async ({ browser }) => {
  test.setTimeout(120_000)
  const { page, finish } = await open_recorded_page(browser, 'particle_gauntlet')
  try {
    const url = new URL(`${DEMO_ORIGIN}/demo/particles_probe.html`)
    url.searchParams.set('kind', 'ambient')
    url.searchParams.set('count', String(DENSE))
    url.searchParams.set('soak', '1')
    await page.goto(url.toString())
    await page.waitForFunction(
      () => Boolean(/** @type {any} */ (window).__probe_ready) || Boolean(/** @type {any} */ (window).__probe_err),
      null,
      { timeout: 40_000 }
    )
    const err = await page.evaluate(() => /** @type {any} */ (window).__probe_err ?? null)
    expect(err, 'soak probe init error').toBeNull()
    await page.waitForTimeout(20_000) // 20s of camera translation + look-sweep, recorded in-page
  } finally {
    const webm = await finish('soak_ambient')
    console.log(`[gauntlet] soak webm → ${webm || 'NOT SAVED'}`)
  }
})
