// Pure procedural-texture NOISE + math helpers for the block-texture baker (§3.6), extracted VERBATIM
// from texture_baker.js (2026-07-05, ≤600-LoC law split — the baker had accreted D159 realism + D164
// leaf ops and crossed the ceiling). No behavior change: byte-identical integer FNV/splitmix hashing,
// Math.sin/cos/random BANNED (determinism law §3.7). texture_baker.js (ops/bake) and the flora shape ops
// both import these; ramp/pixel helpers ride along so an op module needs only this one utils import.

import { clamp, lerp } from '../core/math_utils.js'

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
const U32 = 4294967296

/**
 * Deterministic int-tuple → uint32 hash: FNV-1a + splitmix avalanche (nearby inputs decorrelate). Pure
 * integer (Math.imul) ⇒ engine-stable (determinism law §3.7). @param {...number} vals @returns {number}
 */
export function hash32(...vals) {
  let h = FNV_OFFSET
  for (let i = 0; i < vals.length; i += 1) {
    h = (h ^ (vals[i] | 0)) >>> 0
    h = Math.imul(h, FNV_PRIME) >>> 0
    h = (h ^ (h >>> 15)) >>> 0
    h = Math.imul(h, 0x2c1b3c6d) >>> 0
    h = (h ^ (h >>> 12)) >>> 0
    h = Math.imul(h, 0x297a2d39) >>> 0
    h = (h ^ (h >>> 15)) >>> 0
  }
  return h >>> 0
}

/** Hash → float in [0, 1). @param {...number} vals @returns {number} */
export function hash01(...vals) {
  return hash32(...vals) / U32
}

// clamp + lerp: canonical impls in ../core/math_utils.js (imported at top), re-exported here so the
// baker ops (texture_ops_flora et al.) keep their single utils import.
export { clamp, lerp }

/** Smootherstep (3t²−2t³) — deterministic ramp/noise easing, no transcendentals. @param {number} t 0..1 @returns {number} */
export function smooth(t) {
  return t * t * (3 - 2 * t)
}

/** Precomputes the `freq × freq` hashed lattice-corner grid (so a full field costs freq² hashes, not
 * 4/pixel); mod-freq indexing ⇒ the +1 neighbour wraps free. @param {number} freq @param {number} seed @param {number} layer @param {number} salt @returns {Float64Array} */
export function noise_lattice(freq, seed, layer, salt) {
  const grid = new Float64Array(freq * freq)
  for (let gy = 0; gy < freq; gy += 1)
    for (let gx = 0; gx < freq; gx += 1) grid[gy * freq + gx] = hash01(gx, gy, seed, layer, salt)
  return grid
}

/** Bilinear sample from a precomputed lattice — replicates value_noise exactly (same map/ease/lerp, mod-
 * freq wrap on +1). @param {Float64Array} grid @param {number} freq @param {number} x @param {number} y @param {number} size @returns {number} */
export function lattice_sample(grid, freq, x, y, size) {
  const fx = (x * freq) / size,
    fy = (y * freq) / size
  const x0 = Math.floor(fx),
    y0 = Math.floor(fy)
  const sx = smooth(fx - x0),
    sy = smooth(fy - y0)
  const wx0 = ((x0 % freq) + freq) % freq,
    wy0 = ((y0 % freq) + freq) % freq
  const wx1 = (wx0 + 1) % freq,
    wy1 = (wy0 + 1) % freq
  const v00 = grid[wy0 * freq + wx0],
    v10 = grid[wy0 * freq + wx1]
  const v01 = grid[wy1 * freq + wx0],
    v11 = grid[wy1 * freq + wx1]
  return lerp(lerp(v00, v10, sx), lerp(v01, v11, sx), sy)
}

/** Whole-texture fBm FIELD in [0,1) via cached lattices — Σ `octaves` value noise at ×2 freq / ×0.5 amp,
 * renormalised; every octave wraps mod its integer freq ⇒ seamless, isotropic, multi-scale. Computed ONCE
 * per op. @param {number} size @param {number} base_freq @param {number} octaves @param {number} seed @param {number} layer @param {number} salt @returns {Float64Array} */
export function fbm_field(size, base_freq, octaves, seed, layer, salt) {
  const field = new Float64Array(size * size)
  let amp = 1,
    norm = 0,
    freq = base_freq
  for (let o = 0; o < octaves; o += 1) {
    const grid = noise_lattice(freq, seed, layer, salt + o * 101)
    for (let y = 0; y < size; y += 1)
      for (let x = 0; x < size; x += 1) field[y * size + x] += amp * lattice_sample(grid, freq, x, y, size)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  for (let i = 0; i < field.length; i += 1) field[i] /= norm
  return field
}

/** Tileable 1-D value noise [0,1) along one axis (streaks). @param {number} c @param {number} size @param {number} freq @param {number} seed @param {number} layer @param {number} salt @returns {number} */
export function value_noise_1d(c, size, freq, seed, layer, salt) {
  const fc = (c * freq) / size
  const c0 = Math.floor(fc)
  const s = smooth(fc - c0)
  const a = hash01(((c0 % freq) + freq) % freq, seed, layer, salt)
  const b = hash01((((c0 + 1) % freq) + freq) % freq, seed, layer, salt)
  return lerp(a, b, s)
}

/** Tileable Worley F1/F2 (cell units), one hashed point per wrapped cell. @param {number} x @param {number} y @param {number} size @param {number} freq @param {number} seed @param {number} layer @returns {[number, number]} */
export function worley(x, y, size, freq, seed, layer) {
  const fx = (x * freq) / size
  const fy = (y * freq) / size
  const cx = Math.floor(fx)
  const cy = Math.floor(fy)
  let f1 = Infinity,
    f2 = Infinity
  for (let oy = -1; oy <= 1; oy += 1) {
    for (let ox = -1; ox <= 1; ox += 1) {
      const gx = cx + ox
      const gy = cy + oy
      const wx = ((gx % freq) + freq) % freq
      const wy = ((gy % freq) + freq) % freq
      const px = gx + hash01(wx, wy, seed, layer, 1)
      const py = gy + hash01(wx, wy, seed, layer, 2)
      const dx = px - fx
      const dy = py - fy
      const d2 = dx * dx + dy * dy
      if (d2 < f1) {
        f2 = f1
        f1 = d2
      } else if (d2 < f2) {
        f2 = d2
      }
    }
  }
  return [Math.sqrt(f1), Math.sqrt(f2)]
}

/** Sample a soft colour ramp at t∈[0,1] (smoothstep between stops). @param {import('./texture_baker.js').RampStop[]} stops ascending, non-empty @param {number} t @returns {[number, number, number]} */
export function ramp_color(stops, t) {
  if (t <= stops[0].pos) return stops[0].rgb
  for (let i = 1; i < stops.length; i += 1) {
    if (t <= stops[i].pos) {
      const a = stops[i - 1]
      const b = stops[i]
      const s = smooth((t - a.pos) / (b.pos - a.pos || 1))
      return [lerp(a.rgb[0], b.rgb[0], s), lerp(a.rgb[1], b.rgb[1], s), lerp(a.rgb[2], b.rgb[2], s)]
    }
  }
  return stops[stops.length - 1].rgb
}

/** Multiplies pixel `i`'s RGB by `m` (grain/darken); alpha untouched. @param {Float32Array} buf @param {number} i @param {number} m */
export function mul_rgb(buf, i, m) {
  buf[i] *= m
  buf[i + 1] *= m
  buf[i + 2] *= m
}

/** Iterate pixels row-major (stable byte order), fn(x,y,i) with i=(y·size+x)·4. @param {number} size @param {(x: number, y: number, i: number) => void} fn */
export function for_pixel(size, fn) {
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) fn(x, y, (y * size + x) * 4)
}
