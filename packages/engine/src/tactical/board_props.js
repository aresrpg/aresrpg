// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// OBSTACLE PROP ARCHETYPES — the OPT-IN obstacle style (board.js obstacle_style:'props', for later
// dungeon theming). The DEFAULT board obstacle is a clean retro-style half-height
// BLOCK (simple readable mass), built inline in board.js; these multi-voxel props are kept as a themed
// alternative. The shape variance lives in the prop DESIGN (deterministic, authored), not random rubble,
// so nothing spills outside the cell (D167 spirit) — a themed board can swap them in without new textures.
//
// Three archetypes, deterministically picked per cell from the fight seed (cell hash):
//   0 BOULDER  — 3-4 stacked/offset rounded-ish masses (a lumpy cluster).
//   1 MENHIR   — a tapered standing stone with an offset BROKEN cap + a fallen chunk at its foot.
//   2 STUMP    — a low irregular stump base bristling with 2-3 dead spikes of varied height.
// Each is emitted as axis-aligned voxel boxes (matching board_surface.js's hand-built quad idiom — no
// mergeGeometries dep), rotated by a deterministic 90° variant, in a desaturated dark-stone palette.
// Footprints stay inside ±0.58 of the cell so nothing spills onto neighbours (D167). 2026-07-11.

import { Color } from 'three'

/** Nominal cell edge the archetype metres are authored against (DEFAULT_CELL_SIZE). XZ scales by
 *  cell_size / this; Y (heights) is absolute metres. */
const NOMINAL_CELL = 1.33

/** Per-face shade baked into vertex colour (a cheap chiselled-AO read before the scene sun even hits):
 *  top brightest, sides mid, underside darkest. Multiplied by the per-voxel shade + the cell tint. */
const FACE_TOP = 1.0
const FACE_SIDE = 0.82
const FACE_BOTTOM = 0.55

/**
 * Archetype voxel tables. Each voxel = [lx, ly, lz, sx, sy, sz, shade]:
 *   lx,lz — centre offset from the cell centre, in NOMINAL-cell metres (XZ, scaled at emit).
 *   ly    — centre height above the prop base (metres; base y = 0 sits on the slab top).
 *   sx,sz — footprint size (NOMINAL-cell metres, scaled at emit); sy — height size (metres).
 *   shade — per-voxel tone multiplier (upper/broken faces catch a touch more light).
 * Heights land ~1.3-1.9 m (varied), footprints asymmetric — irregular silhouettes, never a box.
 * @type {[number,number,number,number,number,number,number][][]} */
export const ARCHETYPES = [
  // 0 — BOULDER CLUSTER (low, lumpy, asymmetric; ~1.27 m)
  [
    [-0.08, 0.42, 0.05, 0.92, 0.84, 0.86, 0.9],
    [0.16, 0.86, -0.1, 0.56, 0.52, 0.6, 1.02],
    [0.34, 0.24, 0.3, 0.4, 0.46, 0.42, 0.86],
    [-0.05, 1.12, 0.08, 0.34, 0.3, 0.32, 1.08],
  ],
  // 1 — BROKEN MENHIR (tall, tapered, offset broken cap + a fallen foot chunk; ~1.86 m)
  [
    [0.0, 0.5, 0.0, 0.5, 1.0, 0.52, 0.92],
    [0.03, 1.25, -0.02, 0.4, 0.5, 0.42, 0.98],
    [0.06, 1.62, -0.02, 0.3, 0.28, 0.32, 1.04],
    [0.24, 1.78, 0.05, 0.34, 0.16, 0.3, 1.1], // broken cap — offset sideways (leans/toppling)
    [-0.34, 0.12, 0.22, 0.3, 0.24, 0.28, 0.84], // fallen chunk at the foot
  ],
  // 2 — DEAD STUMP + SPIKES (low base, jagged spikes of varied height; ~1.35 m)
  [
    [0.0, 0.28, 0.0, 0.66, 0.56, 0.62, 0.9],
    [-0.12, 0.9, -0.05, 0.2, 0.9, 0.22, 1.05], // tall spike
    [0.18, 0.66, 0.14, 0.16, 0.7, 0.18, 1.0], // mid spike
    [0.05, 0.5, -0.22, 0.14, 0.5, 0.16, 0.96], // short spike
    [0.3, 0.14, -0.2, 0.26, 0.28, 0.24, 0.82], // root nub
  ],
]

/** Deterministic archetype pick (0|1|2) from a per-cell hash ∈ [0,1). Even three-way split. */
export function pick_archetype(/** @type {number} */ h) {
  return Math.min(2, Math.floor(h * 3))
}

/** Deterministic 90° rotation variant (0|1|2|3) from a per-cell hash ∈ [0,1). */
export function pick_rotation(/** @type {number} */ h) {
  return Math.floor(((((h * 7.13) % 1) + 1) % 1) * 4) % 4
}

/** Rotate a local (x,z) by rot·90° about the cell centre. @returns {[number, number]} */
function rot_xz(/** @type {number} */ x, /** @type {number} */ z, /** @type {number} */ rot) {
  switch (rot & 3) {
    case 1:
      return [-z, x]
    case 2:
      return [-x, -z]
    case 3:
      return [z, -x]
    default:
      return [x, z]
  }
}

/**
 * Push one axis-aligned box (6 CCW-outward faces, verified winding) into shared attribute arrays,
 * with per-face vertex colour = tint × voxel-shade × face-shade (clamped). @param {{positions:number[],
 * normals:number[], colors:number[], indices:number[]}} a @param {number} cx @param {number} cy
 * @param {number} cz box centre @param {number} hx @param {number} hy @param {number} hz half-extents
 * @param {Color} tint base stone colour (already per-cell jittered) @param {number} vshade voxel shade
 */
function push_box(a, cx, cy, cz, hx, hy, hz, tint, vshade) {
  const x0 = cx - hx,
    x1 = cx + hx,
    y0 = cy - hy,
    y1 = cy + hy,
    z0 = cz - hz,
    z1 = cz + hz
  // 8 corners, indexed [x][y][z] with 0=min,1=max
  const C = /** @type {[number,number,number][]} */ ([
    [x0, y0, z0],
    [x1, y0, z0],
    [x1, y1, z0],
    [x0, y1, z0],
    [x0, y0, z1],
    [x1, y0, z1],
    [x1, y1, z1],
    [x0, y1, z1],
  ])
  // face = [normal, [4 corner indices in CCW-outward order], face-shade]
  const faces = /** @type {[[number,number,number], number[], number][]} */ ([
    [[1, 0, 0], [1, 2, 6, 5], FACE_SIDE], // +X  c100 c110 c111 c101
    [[-1, 0, 0], [0, 4, 7, 3], FACE_SIDE], // -X  c000 c001 c011 c010
    [[0, 1, 0], [3, 7, 6, 2], FACE_TOP], // +Y  c010 c011 c111 c110
    [[0, -1, 0], [0, 1, 5, 4], FACE_BOTTOM], // -Y  c000 c100 c101 c001
    [[0, 0, 1], [4, 5, 6, 7], FACE_SIDE], // +Z  c001 c101 c111 c011
    [[0, 0, -1], [0, 3, 2, 1], FACE_SIDE], // -Z  c000 c010 c110 c100
  ])
  const clamp01 = (/** @type {number} */ v) => (v < 0 ? 0 : v > 1 ? 1 : v)
  for (const [n, quad, fshade] of faces) {
    const s = vshade * fshade
    const r = clamp01(tint.r * s),
      g = clamp01(tint.g * s),
      b = clamp01(tint.b * s)
    const base = a.positions.length / 3
    for (const ci of quad) {
      const p = C[ci]
      a.positions.push(p[0], p[1], p[2])
      a.normals.push(n[0], n[1], n[2])
      a.colors.push(r, g, b)
    }
    a.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
}

/**
 * Emit one obstacle prop (archetype `arch`, rotated `rot`) at world XZ (wx,wz), base at `base_y`,
 * appending its voxel geometry into the shared arrays. @param {{positions:number[], normals:number[],
 * colors:number[], indices:number[]}} arrays @param {number} arch archetype 0|1|2 @param {number} rot
 * 0|1|2|3 @param {number} wx @param {number} wz world XZ of the cell centre @param {number} base_y prop
 * base world Y (slab top) @param {number} cell_size @param {Color} tint per-cell stone tint
 */
export function emit_prop(arrays, arch, rot, wx, wz, base_y, cell_size, tint) {
  const sxz = cell_size / NOMINAL_CELL
  const odd = (rot & 1) === 1
  for (const [lx, ly, lz, sx, sy, sz, shade] of ARCHETYPES[arch] ?? ARCHETYPES[0]) {
    const [rx, rz] = rot_xz(lx, lz, rot)
    const hx = (odd ? sz : sx) * 0.5 * sxz
    const hz = (odd ? sx : sz) * 0.5 * sxz
    push_box(arrays, wx + rx * sxz, base_y + ly, wz + rz * sxz, hx, sy * 0.5, hz, tint, shade)
  }
}

/** Fresh empty attribute-array bundle for accumulating props. */
export function make_prop_arrays() {
  return {
    positions: /** @type {number[]} */ ([]),
    normals: /** @type {number[]} */ ([]),
    colors: /** @type {number[]} */ ([]),
    indices: /** @type {number[]} */ ([]),
  }
}

export { NOMINAL_CELL }
export const _for_test = { rot_xz, Color }
