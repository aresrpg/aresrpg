// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FLORA-CHAOS cross-billboard vertex (§3.6) — the per-plane scatter math, extracted from
// terrain_material.js so that file stays under the ≤600-LoC law and the flora geometry has ONE home
// (same split discipline as registry_nodes.js / terrain_ao.js / terrain_winding.js). Pure TSL node
// builder consumed ONLY by the 'foliage' material; see terrain_material.js for the shading chain and
// quad_buffer.js for the ORDINAL AO-bit overlay this reads.
//
// THE FIX (flora reads like a single image with a crossing pattern, repeated the same way…
// it doesn't feel like nature's chaos): ONE X-cross per cell is the ceiling — no jitter makes one stamp
// read as a repeated tile. So the mesher now stamps K crossed PAIRS per cell (registry `cross_pairs`),
// and THIS builder scatters each pair independently — its own yaw, offset, scale, base-height and wind
// phase — so a square metre reads as a unique tangle, never one image tiled across the blocks.

import { cameraPosition, float, length, smoothstep, time, uint, vec2, vec3 } from 'three/tsl'

import { cell_hash } from './registry_nodes.js'

/** Full turn in radians — each plane's Y yaw + wind phase is hash·TWO_PI. */
const TWO_PI = Math.PI * 2
/** Per-plane XZ jitter (±) around the cell centre. 2026-07-04 — forest floor read as "regular
 *  rows … no position variance": a top-down of a dense fern carpet showed a rigid 1 m LATTICE — the old
 *  ±0.35 kept every base inside [0.15,0.85], never reaching the cell edge, so the grid + bare cell-corners
 *  read through. Widened to ±0.5 so a base can wander the FULL cell (and, with CROSS_BASE_WIDTH 1.6 of
 *  overlap, spill into neighbours) — the per-plane hash decorrelates each of the K pairs independently, so
 *  the lattice dissolves into a scattered tangle. Coverage is unchanged (still K plants per occupied cell,
 *  just repositioned); the wide billboard keeps the carpet gapless. */
const JITTER = 0.5
/** Billboard full width in world blocks at scale 1 — >1 so jittered neighbours interlock into a gapless carpet. */
const CROSS_BASE_WIDTH = 1.6
/** Top-vertex wind deflection per block of height (tuft h2 → 0.14, reed h3 → 0.21 m); the base stays planted. */
const SWAY_AMP_PER_BLOCK = 0.07
/** Foliage-only padding for the per-slot GPU frustum AABB. The tallest reed can reach just over 4 m
 *  beyond its occupied chunk after the 1.6 height scale and ±0.14 rad lean are applied, so the generic
 *  solid margin of 1 m can cull a whole visible grass slot at grazing camera angles. Integer 5 is the
 *  smallest conservative margin for the shipped flora vertex envelope (pinned in foliage_variety.test). */
export const foliage_cull_margin = 5
/** FLORA-CHAOS per-plane hash SALT for the Y yaw — the fragment stage RECOMPUTES this same hash off the
 *  (ordinal-folded) plane cell to derive the plane's facing for the sun-dispersion term, so it MUST match
 *  the vertex yaw exactly. Single source of the salt. (Round-3 dispersion; see terrain_material.js.) */
export const YAW_SALT = 11
/** [D164-B]: leaves should be more rotated, not blocky — rotate ALL leaves. Max
 *  random PITCH (radians) for CUTOUT leaf planes so a canopy TUMBLES off the flat vertical-card look —
 *  required on every cutout plane. Grass passes tilt 0 (stays vertical ⇒ its vertex graph is byte-
 *  identical). The plane's up-axis pitches ±LEAF_TILT_MAX about a per-plane random lean azimuth. @type {number} */
export const LEAF_TILT_MAX = 0.6 // [D177 — planes read as skewed] ±34° RIGID rotation (the ±1.1 shear read as skewed parallelograms)
/** [D164-B — leaves also needed to grow in all directions] Cutout leaf clusters get a wider billboard (fuller canopy mass,
 *  more overlap → the hollow shell reads as foliage, not cards). Grass passes 1 (byte-identical). @type {number} */
export const LEAF_WIDTH_MUL = 1.8 // [D164 round-2 — grow them more] the 1.5-2 band
/** Per-plane hash salts for the D164-B tilt angle + lean azimuth (disjoint from the jitter/scale/yaw salts). */
const TILT_SALT = 21
const TILT_DIR_SALT = 22
/** [round-2] fixes "crossed planes" — hash salt for the per-PAIR crossing-angle jitter. */
const CROSS_ANGLE_SALT = 23
/** [round-2] Max crossing-angle jitter (radians): plane B crosses plane A at 90°±34° instead of the rigid
 *  exact-90° X that reads as naked construction. ±0.6 keeps a guaranteed ≥56° separation (planes never
 *  collapse near-parallel into one flat card). Grass passes 0 ⇒ its vertex graph stays byte-identical.
 *  The same flag decorrelates the two faces' TILT hashes (a per-face prime offset) so a pair tumbles as two
 *  independent leaf clumps, not one rigid X. Zero fill cost — pure vertex orientation. @type {number} */
export const LEAF_CROSS_JITTER = 0.6
/** Per-face hash-input offset (a prime) decorrelating plane B's tilt from plane A's when the crossing
 *  jitter is on — far larger than any real plane-cell step, so it never collides with a neighbour cell. */
const FACE_B_TILT_OFFSET = 977

/** Pure JS mirror of the per-plane tilt angle (radians) from a [0,1) hash — the tested twin of the vertex
 *  TSL. `max`=0 (grass) ⇒ ALWAYS 0 (the byte-identical vertical GATE); cutout ⇒ [−max,+max], 0 at h=0.5.
 *  @param {number} h @param {number} [max] @returns {number} */
export function leaf_tilt_angle(h, max = LEAF_TILT_MAX) {
  return (h - 0.5) * 2 * max
}

/** Pure JS mirror of the per-PAIR crossing angle (radians, plane B relative to plane A) from a [0,1) hash —
 *  the tested twin of the vertex TSL below. `jitter`=0 (grass) ⇒ EXACTLY π/2 (the frozen X); cutout ⇒
 *  π/2 ± jitter, π/2 at h=0.5. @param {number} h @param {number} [jitter] @returns {number} */
export function pair_cross_angle(h, jitter = LEAF_CROSS_JITTER) {
  return Math.PI / 2 + (h - 0.5) * 2 * jitter
}

/**
 * @typedef {object} CrossBillboardNodes
 * @property {*} position vec3 node — the LOCAL-space billboard vertex (the caller adds chunk_origin in pool mode)
 * @property {*} plane_cell vec2 node — the ordinal-folded hash cell (the fragment variant/species/hue key)
 */

/**
 * Builds the FLORA-CHAOS cross-billboard vertex for ONE of a flora cell's K independently-randomized
 * planes. The mesher stamps K pairs per cell and tags each with an ORDINAL 0..K-1 in the freed cross AO
 * slice (word_b bits 20-22 — flora has no AO; see quad_buffer.js). Folding the ordinal into the plant's
 * ROOTED world cell on two primes decorrelates EVERY per-plane hash below (jitter, scale, yaw, base-
 * height, wind phase, and — via the returned plane cell — the fragment variant/species/hue) across the K
 * planes, so no two are copies; the two faces of one pair share the ordinal, so a single plant stays one
 * coherent sprite. Plane A (face 6) spans h_dir=(cos,0,sin); plane B (face 7) the +90° perpendicular
 * (−sin,0,cos) — the crossed X rotates rigidly, and Y-rotation leaves the up-normal untouched. Wind is a
 * 2-octave WORLD-XZ time wave, top-weighted by corner_v (bases planted) and desynced by a per-plane phase
 * (out-of-phase shimmer), world-aligned in direction. VISUAL-ONLY: sin/cos are legal here (render class,
 * no determinism/p2p surface — cf. water_material's animated normals).
 * @param {object} p
 * @param {*} p.word_b uint node — the quad's word B (carries the plane ordinal in bits 20-22)
 * @param {*} p.local_x @param {*} p.local_y @param {*} p.local_z uint nodes — the flora cell's local coords
 * @param {*} p.corner_u @param {*} p.corner_v float nodes {0,1} — sprite corner (u horizontal, v base→top)
 * @param {*} p.quad_h uint node — the INTEGER wire quad_h = ceil(cross_height) (billboard envelope, blocks)
 * @param {*} p.height_frac float node — cross_height/ceil ∈ (0,1] (fractional-height scale; 1.0 for integer heights)
 * @param {boolean} [p.grass_variance] D182: bimodal dramatic height variance (grass carpet only)
 * @param {number} [p.scale_spread] per-plane random-scale band widener (default 1 = grass tuning; the
 *   cutout LEAF material passes ~1.7 — D164 "vary in scale")
 * @param {number} [p.tilt] max random plane PITCH in radians (default 0 = grass, stays vertical → byte-
 *   identical; the cutout LEAF material passes LEAF_TILT_MAX — D164-B "more rotated")
 * @param {number} [p.width_mul] billboard-width multiplier (default 1 = grass, byte-identical; the cutout
 *   LEAF material passes LEAF_WIDTH_MUL — D164-B "also grow all leaves")
 * @param {boolean} [p.sway_enabled] [S-85] tier wind gate — false (LOW) skips the whole sway subgraph
 * @param {number} [p.cross_angle_jitter] [round-2 — crossed-planes symptom] max crossing-angle jitter
 *   (radians): plane B meets plane A at 90°±this, and the two faces' TILT hashes decorrelate — the rigid
 *   X-construction dissolves. Default 0 = grass, byte-identical; cutout passes LEAF_CROSS_JITTER.
 * @param {*} p.is_cross_a bool node — face 6 (plane A) vs face 7 (plane B)
 * @param {*} p.chunk_origin vec3 node or null — pooled world origin (folds into the hash cell), else local
 * @returns {CrossBillboardNodes}
 */
export function cross_billboard_nodes({
  word_b,
  local_x,
  local_y,
  local_z,
  corner_u,
  corner_v,
  quad_h,
  height_frac,
  is_cross_a,
  chunk_origin,
  grass_variance = false,
  scale_spread = 1,
  tilt = 0,
  width_mul = 1,
  sway_enabled = true,
  cross_angle_jitter = 0,
}) {
  const ordinal = word_b.shiftRight(uint(20)).bitAnd(uint(0x7))
  const ord_f = float(ordinal)
  const world_cell_x = chunk_origin ? float(local_x).add(chunk_origin.x) : float(local_x)
  const world_cell_z = chunk_origin ? float(local_z).add(chunk_origin.z) : float(local_z)
  // Ordinal folded on two primes → per-plane decorrelation. Collisions need two cells 101/53 blocks apart
  // AND matching ordinals — never both in a meadow close-up, so no visible repeat.
  const plane_cell_x = world_cell_x.add(ord_f.mul(float(101)))
  const plane_cell_z = world_cell_z.add(ord_f.mul(float(53)))

  // Per-plane 2D jitter (centred) + INDEPENDENT width/height scale (thin-tall / wide-short / medium).
  const jx = cell_hash(plane_cell_x, plane_cell_z, 7).mul(float(2)).sub(float(1)).mul(float(JITTER))
  const jz = cell_hash(plane_cell_x, plane_cell_z, 8).mul(float(2)).sub(float(1)).mul(float(JITTER))
  // [D164 — vary in scale]: `scale_spread` (default 1 = the grass tuning) widens the per-plane
  // random band around ~1.0 — the CUTOUT leaf material passes ~1.7 so canopy puffs range ≈0.5-1.5.
  const spread = float(scale_spread)
  // [D182 — repeated "not variant enough in height" feedback] BIMODAL HEIGHT: pow-skewed hash → most tufts short
  // (knee-high), a scattered few TALL (waist-high standouts) — the meadow reads layered, not mowed.
  // Applied only when the caller passes grass_variance (leaves keep their own tuning).
  const h_hash = cell_hash(plane_cell_x, plane_cell_z, 24)
  // [D174 — low fps; drastically reduce sprite quality with distance] FAR ORDINAL COLLAPSE:
  // past ~55 m, every plane pair beyond the first (ordinal > 0) scales to ZERO (degenerate → no
  // fragments, culled free by the raster) — distant clusters keep their ordinal-0 cross silhouette at
  // HALF the planes. Composes with the near-camera fade: full canopy price only in the ~2-55 m band.
  // Applied via width/height scale so the vertex math stays one path (no branches).
  const cam_d = length(
    vec3(chunk_origin.x, chunk_origin.y, chunk_origin.z)
      .add(vec3(local_x, local_y, local_z))
      .sub(cameraPosition)
  )
  const far_keep = ordinal.equal(uint(0)).select(float(1), float(1).sub(smoothstep(float(30), float(42), cam_d))) // [D176] collapse earlier — fps
  const width_scale = cell_hash(plane_cell_x, plane_cell_z, 9)
    .sub(0.5)
    .mul(float(0.6).mul(spread))
    .add(float(1.0))
    .mul(far_keep) // 1±0.3·spread
  const height_scale = grass_variance
    ? h_hash.pow(1.7).mul(float(1.15)).add(float(0.45)) // [D182] 0.45-1.6, short-skewed w/ tall outliers
    : cell_hash(plane_cell_x, plane_cell_z, 10).sub(0.5).mul(float(0.5).mul(spread)).add(float(1.03)) // ~1±0.25·spread
  // FULL-RANDOM Y yaw → the X becomes a scattered fan of angles instead of a fixed 45°/135° cross. Salt
  // YAW_SALT is shared: the fragment recomputes this yaw off the plane cell for the sun-dispersion term
  // (FOLIAGE only — the grass path, which always passes cross_angle_jitter 0, so its B = A+90° mirror holds).
  const yaw = cell_hash(plane_cell_x, plane_cell_z, YAW_SALT).mul(float(TWO_PI))
  const cos_y = yaw.cos()
  const sin_y = yaw.sin()
  /** @type {*} */
  let h_dir
  if (cross_angle_jitter !== 0) {
    // [round-2] fixes "crossed planes" — break the rigid exact-90° X: plane B crosses plane A
    // at 90°±cross_angle_jitter (hashed per PAIR — pair_cross_angle is the tested JS twin), so every cell's
    // pair meets at its own angle and the uniform X-construction dissolves. CUTOUT leaves only; grass keeps
    // the frozen else-branch below (byte-identical graph — the D164-B gating discipline).
    const delta = cell_hash(plane_cell_x, plane_cell_z, CROSS_ANGLE_SALT)
      .sub(float(0.5))
      .mul(float(2 * cross_angle_jitter))
    const yaw_b = yaw.add(float(Math.PI / 2)).add(delta)
    h_dir = is_cross_a.select(vec3(cos_y, float(0), sin_y), vec3(yaw_b.cos(), float(0), yaw_b.sin()))
  } else {
    h_dir = is_cross_a.select(vec3(cos_y, float(0), sin_y), vec3(sin_y.mul(float(-1)), float(0), cos_y))
  }
  // Base-height wobble, biased SUNKEN so silhouettes break the baseline without floating a blade off ground.
  const base_dy = cell_hash(plane_cell_x, plane_cell_z, 12).mul(float(0.2)).sub(float(0.12)) // −0.12..+0.08
  // Rooted base = cell CENTRE (+0.5) + jitter, on the wobbled ground height.
  const base = vec3(
    float(local_x).add(float(0.5)).add(jx),
    float(local_y).add(base_dy),
    float(local_z).add(float(0.5)).add(jz)
  )
  // Horizontal span ∓half-width along h_dir, CENTRED on the base (a widened plant grows both ways). Width
  // in WORLD blocks = CROSS_BASE_WIDTH·width_scale (~1.1-2.1). Vertical: corner_v sweeps 0→quad_h·height_scale.
  const along = corner_u.sub(float(0.5)).mul(float(2)) // {0,1} → {−1,+1}
  // [D164-B "grow all leaves"] width_mul (1 = grass, byte-identical; cutout LEAF_WIDTH_MUL) fattens the
  // leaf billboard so clusters overlap into a fuller mass (0.5·width_mul folds into the frozen half constant).
  const half_w = float(CROSS_BASE_WIDTH)
    .mul(width_scale)
    .mul(float(0.5 * width_mul))
  const horiz = h_dir.mul(along.mul(half_w))
  // Effective blocks-tall = wire quad_h (ceil envelope) × height_frac (fractional cross_height, e.g.
  // grass_tuft 1.4/2) × per-plane height_scale. The sprite UV sweeps 0→this, so the whole blade (art +
  // silhouette + sway reach below) scales together — a shorter waist-high carpet, not a clipped tall one.
  const eff_h = float(quad_h).mul(height_frac)
  const vscale = corner_v.mul(eff_h).mul(height_scale) // scalar rise up the plane (blocks)
  // [D164-B "more rotated"] grass (tilt 0) keeps the FROZEN vertical axis (byte-identical); cutout leaf
  // planes pitch their up-axis by a per-plane random tilt toward a random lean azimuth, so a canopy tumbles
  // off the flat vertical-card look. Gated on the JS `tilt` param ⇒ the grass vertex graph is untouched.
  let vert = /** @type {*} */ (vec3)(float(0), vscale, float(0))
  let horiz_t = horiz
  if (tilt !== 0) {
    // [D177 — planes read as skewed rather than grown] RIGID plane rotation: the first pass tilted ONLY
    // the up-axis (the width axis stayed horizontal) ⇒ at large angles every plane sheared into a
    // parallelogram. Rodrigues axis-angle about a horizontal axis â(az) now rotates BOTH plane axes —
    // the plane tumbles as a rigid quad. Grass keeps tilt=0 ⇒ byte-identical vertex graph.
    // [round-2 — crossed-planes symptom] with the crossing jitter on, plane B's tilt hashes take a
    // per-face prime offset so the two faces LEAN independently — the pair reads as two separate leaf
    // clumps, not one rigid X tumbling as a unit. (jitter 0 ⇒ offset absent — the frozen shared-tilt pair.)
    const tilt_cell_x =
      cross_angle_jitter !== 0 ? plane_cell_x.add(is_cross_a.select(float(0), float(FACE_B_TILT_OFFSET))) : plane_cell_x
    const tilt_a = cell_hash(tilt_cell_x, plane_cell_z, TILT_SALT)
      .sub(float(0.5))
      .mul(float(2 * tilt))
    const az = cell_hash(tilt_cell_x, plane_cell_z, TILT_DIR_SALT).mul(float(TWO_PI))
    const ax = az.cos()
    const azs = az.sin()
    const ct = tilt_a.cos()
    const st = tilt_a.sin()
    /** Rodrigues rotate v about the horizontal unit axis (ax, 0, azs). @param {*} v @returns {*} */
    const rot = (/** @type {*} */ v) => {
      const cross = /** @type {*} */ (vec3)(
        azs
          .mul(v.z)
          .negate()
          .add(v.y.mul(0).sub(azs.mul(v.y)).mul(0))
          .add(azs.mul(v.y).negate()),
        azs.mul(v.x).sub(ax.mul(v.z)),
        ax.mul(v.y)
      )
      // â×v for â=(ax,0,azs): (0·v.z − azs·v.y, azs·v.x − ax·v.z, ax·v.y − 0·v.x)
      const c = /** @type {*} */ (vec3)(azs.mul(v.y).negate(), azs.mul(v.x).sub(ax.mul(v.z)), ax.mul(v.y))
      const adotv = ax.mul(v.x).add(azs.mul(v.z))
      const apar = /** @type {*} */ (vec3)(ax, float(0), azs).mul(adotv)
      return v
        .mul(ct)
        .add(c.mul(st))
        .add(apar.mul(float(1).sub(ct)))
    }
    vert = rot(/** @type {*} */ (vec3)(float(0), vscale, float(0)))
    horiz_t = rot(horiz)
  }

  // Wind: 2-octave world-XZ time wave, top-weighted (corner_v·quad_h), per-plane phase, world-aligned.
  // [S-85] STATIC at LOW (`sway_enabled=false` — "no grass moving, like very low end and
  // mobile"): the whole wind subgraph is skipped, so the per-vertex wave ALU is never built and the flora
  // holds perfectly still. MEDIUM/HIGH build the shipped 0.07-amp wave below (byte-identical to today).
  let sway = /** @type {any} */ (vec3)(float(0), float(0), float(0))
  if (sway_enabled) {
    const plane_phase = cell_hash(plane_cell_x, plane_cell_z, 13).mul(float(TWO_PI))
    const sway_phase = world_cell_x
      .mul(float(0.35))
      .add(world_cell_z.mul(float(0.27)))
      .add(plane_phase)
    const sway_a = time.mul(float(1.5)).add(sway_phase).sin()
    const sway_b = time
      .mul(float(2.7))
      .add(world_cell_x.mul(float(0.6)))
      .add(world_cell_z.mul(float(-0.4)))
      .add(plane_phase)
      .sin()
    let sway_wave = sway_a.mul(float(0.7)).add(sway_b.mul(float(0.3)))
    // [D176 — movement needed to blur; feels too aliased] distance-damped wind: past ~30 m a swaying
    // 1-px-wide blade is pure temporal aliasing (shimmer) — the sway amplitude fades to ZERO by 55 m,
    // so distant fields hold still (calm reads better than crawling static). Near sway untouched.
    sway_wave = sway_wave.mul(float(1).sub(smoothstep(float(30), float(55), cam_d)))
    const sway_reach = corner_v.mul(eff_h).mul(float(SWAY_AMP_PER_BLOCK))
    // [2026-07-03 tsc] vec3(node,node,node) overload gap in three's TSL typings — args are valid nodes.
    sway = /** @type {any} */ (vec3)(sway_wave.mul(sway_reach), float(0), sway_b.mul(sway_reach).mul(float(0.5)))
  }

  return { position: base.add(horiz_t).add(vert).add(sway), plane_cell: vec2(plane_cell_x, plane_cell_z) }
}
