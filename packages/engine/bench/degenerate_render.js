// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// DEGENERATE-RENDER FLOOR — a pure, dependency-free verdict over one rendered frame's RGBA bytes.
// Failure class it exists for (proven live, naga-127 nesting cliff): the fragment pipeline dies
// SILENTLY — terrain stops drawing while collision and every data oracle stay green — so the only
// honest tripwire is the pixels themselves. Five cheap statistics over an evenly-sampled grid:
//   1. opaque share        — did the canvas present anything at all (alpha floor)
//   2. Shannon entropy     — color diversity over 4-bit/channel quantized colors (solid ⇒ 0 bits)
//   3. dominant share      — largest quantized color's share (single-color ⇒ ~1.0)
//   4. edge density        — share of adjacent sample pairs with a luma step > EDGE_DELTA
//   5. luma contrast       — p95 − p5 of the luminance histogram (flat ⇒ ~0)
// A frame is DEGENERATE (nonzero code) when it never presented, is essentially one color, or has
// no spatial structure at all. Thresholds are a FLOOR, not a quality bar: calibrated so the
// blank/flat/single-color trio fails while every legitimate scene class (day, dusk, night sky,
// underwater, particle A/B, sky-only poses) passes with ≥2× headroom — see the calibration table
// in the lane report and bench/degenerate_render.test.js. Pure by construction: no imports, no
// mutation, deterministic — runnable in bun (unit), node (_shared.js), or in-page via the dev
// server (`await import('/bench/degenerate_render.js')`, the classify_holes idiom).

export const RENDER_FLOOR = {
  min_opaque_share: 0.02, // <2% texels with alpha ⇒ the canvas never presented → blank
  min_entropy_bits: 1.0, // solid = 0 bits; any real scene measures > 2.5
  max_dominant_share: 0.95, // one quantized color owning >95% of the frame ⇒ clear-color-only
  // Calibrated on the 252-frame headed-Metal corpus: genuinely-dark WORLD scenes (moonlit night
  // sky 0.0052, ambient fireflies 0.0051, night particles 0.0069+) all sit ≥2.5× above 0.002,
  // while a dead canvas measures EXACTLY 0 — no 12-step luma edge exists in a flat/solid frame.
  min_edge_density: 0.002,
  min_contrast: 8, // p95−p5 luma below 8 is visually flat (±2 LSB jitter ≈ 5)
  edge_delta: 12, // luma step that counts as an edge between adjacent samples
  alpha_min: 16, // alpha at or below this reads as "not presented"
  target_samples: 66_000, // stride is derived so a frame costs O(66k) texel reads regardless of size
}

const luma_of = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/**
 * Classifies one frame as healthy (code 0) or degenerate (nonzero bitmask: 1 blank ·
 * 2 flat_color · 4 no_structure), with the five raw metrics for gate JSONs.
 * @param {Uint8ClampedArray | Uint8Array} pixels RGBA bytes, row-major (ImageData.data layout)
 * @param {{ width: number, height: number }} size frame dimensions in texels
 * @returns {{ code: number, flags: string[], metrics: { opaque_share: number, entropy_bits: number, dominant_share: number, edge_density: number, contrast_p95_p5: number } }}
 */
export function degenerate_render_verdict(pixels, { width, height }) {
  if (!pixels || pixels.length < width * height * 4)
    throw new Error(`degenerate_render_verdict: pixels shorter than ${width}×${height}×4`)
  const floor = RENDER_FLOOR
  const stride = Math.max(1, Math.round(Math.sqrt((width * height) / floor.target_samples)))
  const color_counts = new Uint32Array(4096) // 4 bits × RGB = 12-bit quantized color space
  const luma_counts = new Uint32Array(256)
  let samples = 0
  let opaque = 0
  let edges = 0
  let pairs = 0
  const sample_at = (x, y) => {
    const i = (y * width + x) * 4
    return pixels[i + 3] > floor.alpha_min ? i : -1 // -1 = transparent, excluded from color stats
  }
  for (let y = 0; y < height; y += stride) {
    for (let x = 0; x < width; x += stride) {
      samples += 1
      const i = sample_at(x, y)
      if (i < 0) continue
      opaque += 1
      const r = pixels[i]
      const g = pixels[i + 1]
      const b = pixels[i + 2]
      color_counts[((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)] += 1
      const luma = luma_of(r, g, b)
      luma_counts[Math.min(255, Math.round(luma))] += 1
      for (const [nx, ny] of [
        [x + stride, y],
        [x, y + stride],
      ]) {
        if (nx >= width || ny >= height) continue
        const j = sample_at(nx, ny)
        if (j < 0) continue
        pairs += 1
        if (Math.abs(luma - luma_of(pixels[j], pixels[j + 1], pixels[j + 2])) > floor.edge_delta) edges += 1
      }
    }
  }
  let entropy_bits = 0
  let dominant = 0
  for (const count of color_counts) {
    if (count === 0) continue
    if (count > dominant) dominant = count
    const p = count / opaque
    entropy_bits -= p * Math.log2(p)
  }
  // Nearest-rank percentiles off the cumulative luma histogram (harness.js methodology, no sort).
  const rank_of = (share) => {
    const rank = Math.max(1, Math.ceil(share * opaque))
    let cumulative = 0
    for (let luma = 0; luma < 256; luma += 1) {
      cumulative += luma_counts[luma]
      if (cumulative >= rank) return luma
    }
    return 255
  }
  const metrics = {
    opaque_share: samples ? opaque / samples : 0,
    entropy_bits,
    dominant_share: opaque ? dominant / opaque : 1,
    edge_density: pairs ? edges / pairs : 0,
    contrast_p95_p5: opaque ? rank_of(0.95) - rank_of(0.05) : 0,
  }
  const flags = []
  const structureless = metrics.edge_density < floor.min_edge_density
  if (metrics.opaque_share < floor.min_opaque_share) flags.push('blank')
  // flat_color demands color collapse AND no structure: a real moonlit night frame is just as
  // color-collapsed (dominant 0.96, entropy 0.34 measured) but its moon rim / stars / cloud bands
  // still carve edges — a dead canvas carves none. Structure is the honest discriminator.
  if (
    metrics.entropy_bits < floor.min_entropy_bits &&
    metrics.dominant_share > floor.max_dominant_share &&
    structureless
  )
    flags.push('flat_color')
  if (structureless && metrics.contrast_p95_p5 < floor.min_contrast) flags.push('no_structure')
  const bit_of = { blank: 1, flat_color: 2, no_structure: 4 }
  return { code: flags.reduce((code, flag) => code | bit_of[flag], 0), flags, metrics }
}
