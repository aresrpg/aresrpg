// Canonical scalar math helpers — the ONE home for clamp / lerp / smoothstep, replacing the
// byte-identical per-file copies that had drifted across the tree (repo audit 2026-07-10). Pure,
// stable, dependency-free. NOTE: `smoothstep` here is the CLASSIC Hermite (3t²−2t³); it is NOT the
// smootherstep (6t⁵−15t⁴+10t³) that lod/far_tint.js keeps locally for its LOD tint easing — those
// are different curves, do not merge them.

/**
 * Clamp `v` into [lo, hi]. @param {number} v @param {number} lo @param {number} hi @returns {number}
 */
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * Linear interpolation from `a` to `b` by `t`. @param {number} a @param {number} b @param {number} t
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t
}

/**
 * Classic Hermite smoothstep: 0 below `e0`, 1 above `e1`, 3t²−2t³ eased between. Guards e1≤e0 as a
 * hard step. @param {number} e0 @param {number} e1 @param {number} x @returns {number} in [0,1]
 */
export function smoothstep(e0, e1, x) {
  if (e1 <= e0) return x < e0 ? 0 : 1
  let t = (x - e0) / (e1 - e0)
  if (t < 0) t = 0
  if (t > 1) t = 1
  return t * t * (3 - 2 * t)
}
