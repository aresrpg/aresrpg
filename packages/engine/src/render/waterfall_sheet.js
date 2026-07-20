// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WATERFALL SHEETS + spray + basin foam (ENGINE_AAA_PLAN §4.2 step 2-4, lane B4) — an ADDITIVE
// render overlay, DEFAULT ON since 2026-07-11 (?falls=0 = escape hatch; A/B-proven at +0.1 ms p50).
// ZERO water_material.js edits (the frozen-tuning law): the voxel water keeps its depth + placeholder
// coverage and is the permanent fallback if a sheet is culled
// (?falls=0 = byte-identical). For every face-resolved FallSpan (src/gen/waterfall_registry.js, lane
// A5) in the streamed ring this draws: (1) a flowing SHEET quad 0.15 blk proud of the cliff face —
// one merged BufferGeometry per column, one draw call, a scrolling 2-octave value-noise whitewater
// material (the mana_barrier TSL idiom: unlit MeshBasicNodeMaterial, hash-lattice noise, `time`-driven
// scroll — render class, legal); (2) SPRAY billboards at the basin (the particles.js SpriteNodeMaterial
// + instanceIndex pattern, stateless arc = pure fn of seed+time); (3) a FOAM disc where the sheet meets
// the water. Tier ladder (the "barely animate on LOW" law): LOW = sheet only, scroll ×0.3, NO
// spray/foam; MEDIUM = sheet + spray + foam; HIGH = + denser spray (mist).
//
// LIFECYCLE (the ring hook): engine.js threads ring_manager's on_chunk_loaded/unloaded coord to
// note_load/note_unload. Falls are a COLUMN property (cy-independent), so a per-"cx,cz" refcount builds
// the group ONCE on the first resident cy and disposes it when the last cy leaves. Spans come from an
// injected get_spans(cx,cz) (world_gen.world_fall_spans) so the pure geometry is unit-testable with a
// fake — no gen/GPU in the test.
//
// FACE REALITY (A5 doc): face is the sheet-mount direction — the higher upstream neighbor when one
// resolves, else (A5 coverage fallback) the lowest downstream neighbor the water pours over. Every
// span with a face + height ≥ MIN_SHEET_H renders a sheet; only a flat lip with no lower neighbor
// stays face:null and shows voxel water. This closes the dense-cascade gap that left ~80-95% of a
// cascade's columns as bare glassy blocks (a known defect). Per-chunk windows still lose
// cross-chunk edge faces (A5's documented single-chunk seam); acceptable MVP.
//
// PERF: sheets ~0.1 ms (few small transparent quads resident, ~0 when none); spray 0.1-0.3 near a
// fall, distance-faded to nothing past ~150 m (past which the sheet alone carries — §4.2 premortem).
// COST NOTE: get_spans recomputes the hydrology column profile main-thread once per loaded column under
// the overlay (mirrors world_biome_at); amortized over stream-in, refcount-deduped across the 12 cy,
// and served by world_gen's memoized column profiles — measured at +0.1 ms p50 on the default path.

import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  PlaneGeometry,
  Vector3,
} from 'three'
import { MeshBasicNodeMaterial, SpriteNodeMaterial } from 'three/webgpu'
import {
  Fn,
  attribute,
  cameraPosition,
  float,
  fract,
  hash,
  instanceIndex,
  length,
  mix,
  reference,
  smoothstep,
  time,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'

import { sky_day_factor } from './water_material.js'

/** @typedef {import('../gen/waterfall_registry.js').FallSpan} FallSpan */
/** @typedef {import('../core/quality/tiers.js').TierName} TierName */

// ── tuning constants ───────────────────────────────────────────────────────────────────────────────
/** Sheet stands this many blocks off the cliff-face plane (toward the open/low side) — z-fight-free over
 *  the voxel water/terrain at every LOD distance (the z-fight sweep proof). */
export const SHEET_PROUD = 0.15
/** Min span drop (blocks) that gets a sheet — the MIN-DROP GATE (fixes "even
 *  1-block terrace steps are sheeted", screenshotted at a terraced hillside as giant opaque white
 *  walls). A 1-2 block terrace step reads fine as plain voxel water underneath; only a real ≥3-block
 *  continuous drop earns a flowing sheet. Coincides numerically with MIN_BASIN_H below (both 3) — kept
 *  as separate constants: independently tunable, and a future sheet-without-basin call stays cheap. */
export const MIN_SHEET_H = 3
/** Min span drop that also gets spray + foam (a real fall, not a 1-blk trickle). */
export const MIN_BASIN_H = 3
/** Cap on spray/foam emitters per column (nearest/tallest first) — bounds draw calls at a dense cascade. */
export const MAX_BASINS_PER_COLUMN = 4
/** Camera distance (m) past which spray fully fades (the sheet carries the read alone). */
export const SPRAY_FADE_FAR = 165
export const SPRAY_FADE_NEAR = 90
/** Whitewater base tint (kept < 1 so stacked foam never crosses the 2.05 bloom threshold — no white halo).
 *  RE-TUNED (defect #2, same day): the glass-fix pass above nudged this whiter+brighter to
 *  kill the "light rays on glass" read, but at a terraced hillside the raised alpha painted "giant OPAQUE
 *  WHITE vertical slabs... reading as white walls, not water." First pull-back (0.6/0.7/0.78 body alpha
 *  0.55-0.70) measured only a ~15-unit/channel, ~36% coverage drop at the exact repro spot — that spot is
 *  a genuine dense multi-tier cascade cluster (several legit ≥3-block falls close together even after the
 *  MIN-DROP gate), so a single translucent LAYER still stacks with its neighbors in view depth. Pulled
 *  further into clearly-blue translucent-water territory; FOAM_WHITE (crest lip / foam disc / spray) stays
 *  bright — those are the LOCALIZED accents (crest + impact), never the whole face. */
// 2026-07-12 REOPEN (flowing water read as static transparent cubes with a glassy shine; the shader
// looked cool but the material read as off): the SHEET was too translucent (body alpha 0.42-0.57), so
// the glassy voxel water BEHIND it (its Fresnel sky-mirror) dominated and the fall read as static glass.
// The fix is explicit: transparency way down (milky white-blue, high alpha), specular way down. Nudged
// the base a touch milkier here; the real levers are body alpha (raised) + the SCROLLING foam filaments
// (contrast raised) so the downward MOTION reads over an opaque aerated sheet. This supersedes the prior
// pull-down; the MIN_SHEET_H=3 gate (terraces excluded) is what keeps the higher alpha off the "white walls".
const WHITEWATER = [0.4, 0.5, 0.6]
const FOAM_WHITE = [0.86, 0.92, 0.96]

/** A5 QuadFace ids (kept local, not imported — same convention as mesher/waterfall_registry). */
const FACE_PX = 0
const FACE_NX = 1
const FACE_PZ = 4
const FACE_NZ = 5

/** @param {FallSpan} s @returns {boolean} true when the span has a mountable (non-null) cliff face. */
function has_face(s) {
  return s.face === FACE_PX || s.face === FACE_NX || s.face === FACE_PZ || s.face === FACE_NZ
}

// ── tier ladder (pure; the "barely animate on LOW" law) ─────────────────────────────────────────────
/** Sheet scroll-speed multiplier: LOW crawls (×0.3), MEDIUM/HIGH flow. @param {TierName} tier @returns {number} */
export function scroll_speed_for(tier) {
  return tier === 'low' ? 0.3 : 1.0
}
/** Spray billboards per basin: LOW 0 (kills spray structurally), MEDIUM 48, HIGH 96 (mist). 2026-07-12 —
 *  foam/splash read as an unrealistic geyser: HALVED (was 96/192) — impact spray is small
 *  and sparse, not a fountain of puffs. @param {TierName} tier @returns {number} */
export function spray_count_for(tier) {
  if (tier === 'low') return 0
  return tier === 'high' ? 96 : 48
}
/** Basin foam disc on MEDIUM+ only. @param {TierName} tier @returns {boolean} */
export function foam_enabled_for(tier) {
  return tier !== 'low'
}

// ── pure geometry (unit-tested; no three/GPU dependency in the math) ────────────────────────────────
/**
 * The four world corners + run length of one face-resolved span's vertical sheet quad, or null for a
 * null-face / zero-height span. The sheet hangs on the cliff-face boundary plane, SHEET_PROUD toward the
 * open (low) side. Corners CCW from bottom-near: [bl, br, tr, tl]; `run` = quad width in blocks (the u
 * axis); `u0` = the ABSOLUTE world coordinate the run starts at (z0 for an X-normal wall, x0 for a
 * Z-normal one) — WIDTH SANITY (same slab report): build_sheet_geometry samples
 * the whitewater noise at u0+[0..run] instead of a span-local [0..run], so two adjacent-but-unmerged
 * same-height falls (the common case — merge_fall_spans' EXACT-match rule keeps most real spans width 1,
 * per its own doc) land on DIFFERENT noise-lattice cells instead of literally the same one. The old
 * local-zero basis made every isolated same-height column replay an IDENTICAL frame of noise — a tiled
 * repeat that read as one monolithic slab rather than distinct falls.
 * @param {FallSpan} s @param {number} [proud]
 * @returns {{ corners: [number,number,number][], run: number, height: number, u0: number } | null}
 */
export function span_quad(s, proud = SHEET_PROUD) {
  if (!has_face(s)) return null
  const height = s.y_top - s.y_bot
  if (height < MIN_SHEET_H) return null
  const yb = s.y_bot
  const yt = s.y_top
  if (s.face === FACE_PX || s.face === FACE_NX) {
    // X-normal wall: run along Z, fixed x-plane. +X cliff → plane at x1+1 (proud toward −X); −X → x0 (proud +X).
    const px = s.face === FACE_PX ? s.x1 + 1 - proud : s.x0 + proud
    const z_lo = s.z0
    const z_hi = s.z1 + 1
    return {
      corners: [
        [px, yb, z_lo],
        [px, yb, z_hi],
        [px, yt, z_hi],
        [px, yt, z_lo],
      ],
      run: z_hi - z_lo,
      height,
      u0: z_lo,
    }
  }
  // Z-normal wall: run along X, fixed z-plane.
  const pz = s.face === FACE_PZ ? s.z1 + 1 - proud : s.z0 + proud
  const x_lo = s.x0
  const x_hi = s.x1 + 1
  return {
    corners: [
      [x_lo, yb, pz],
      [x_hi, yb, pz],
      [x_hi, yt, pz],
      [x_lo, yt, pz],
    ],
    run: x_hi - x_lo,
    height,
    u0: x_lo,
  }
}

/**
 * Merge every face-resolved span of a column into ONE indexed BufferGeometry (position + `aSheet`
 * vec3 = (u-blocks-along-run, v∈[0,1] bottom→top, span height blocks)). One draw call per column.
 * @param {FallSpan[]} spans @returns {{ geometry: BufferGeometry, quad_count: number }}
 */
export function build_sheet_geometry(spans) {
  /** @type {{ corners: [number,number,number][], run: number, height: number, u0: number }[]} */
  const quads = []
  for (const s of spans) {
    const q = span_quad(s)
    if (q) quads.push(q)
  }
  const n = quads.length
  const positions = new Float32Array(n * 4 * 3)
  const sheet = new Float32Array(n * 4 * 3) // aSheet: (u, v, height)
  const index = new Uint32Array(n * 6)
  for (let i = 0; i < n; i += 1) {
    const { corners, run, height, u0 } = quads[i]
    // per-corner uv: [ (u0,0) (u0+run,0) (u0+run,1) (u0,1) ] — ABSOLUTE world-anchored u (WIDTH SANITY,
    // span_quad's u0 doc above): keeps adjacent falls out of noise-phase lockstep.
    const uv = [
      [u0, 0],
      [u0 + run, 0],
      [u0 + run, 1],
      [u0, 1],
    ]
    for (let c = 0; c < 4; c += 1) {
      const p = (i * 4 + c) * 3
      const [wx, wy, wz] = corners[c]
      const [cu, cv] = uv[c]
      positions[p] = wx
      positions[p + 1] = wy
      positions[p + 2] = wz
      sheet[p] = cu
      sheet[p + 1] = cv
      sheet[p + 2] = height
    }
    const base = i * 4
    const io = i * 6
    index[io] = base
    index[io + 1] = base + 1
    index[io + 2] = base + 2
    index[io + 3] = base
    index[io + 4] = base + 2
    index[io + 5] = base + 3
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(positions, 3))
  geometry.setAttribute('aSheet', new BufferAttribute(sheet, 3))
  geometry.setIndex(new BufferAttribute(index, 1))
  return { geometry, quad_count: n }
}

/**
 * @typedef {object} Basin the impact point of one fall, for spray + foam placement.
 * @property {[number,number,number]} pos world XYZ at the water surface under the fall
 * @property {number} radius foam disc / spray spread radius (blocks)
 */
/**
 * Select up to MAX_BASINS_PER_COLUMN impact points for a column: the tallest face-resolved falls
 * (height ≥ MIN_BASIN_H). Basin = the centre of a span's bottom edge. Empty on LOW (spray/foam off).
 * @param {FallSpan[]} spans @param {TierName} tier @returns {Basin[]}
 */
export function select_basins(spans, tier) {
  if (spray_count_for(tier) === 0 && !foam_enabled_for(tier)) return []
  const tall = spans.filter((s) => has_face(s) && s.y_top - s.y_bot >= MIN_BASIN_H)
  tall.sort((a, b) => b.y_top - b.y_bot - (a.y_top - a.y_bot))
  /** @type {Basin[]} */
  const out = []
  for (const s of tall.slice(0, MAX_BASINS_PER_COLUMN)) {
    let x
    let z
    let run
    if (s.face === FACE_PX || s.face === FACE_NX) {
      x = s.face === FACE_PX ? s.x1 + 1 - SHEET_PROUD : s.x0 + SHEET_PROUD
      z = (s.z0 + s.z1 + 1) / 2
      run = s.z1 + 1 - s.z0
    } else {
      z = s.face === FACE_PZ ? s.z1 + 1 - SHEET_PROUD : s.z0 + SHEET_PROUD
      x = (s.x0 + s.x1 + 1) / 2
      run = s.x1 + 1 - s.x0
    }
    out.push({ pos: [x, s.y_bot, z], radius: Math.max(0.7, run * 0.5) })
  }
  return out
}

// ── TSL materials (the mana_barrier / particles idiom) ──────────────────────────────────────────────
/** 2-D value noise in [0,1) over an integer lattice (hash corners + smoothstep bilinear) — the
 *  mana_barrier `wall_noise` idiom, pure TSL, zero textures. @param {*} px @param {*} py @param {number} salt */
function sheet_noise(px, py, salt) {
  const x0 = px.floor()
  const y0 = py.floor()
  const ux = smoothstep(float(0), float(1), px.sub(x0))
  const uy = smoothstep(float(0), float(1), py.sub(y0))
  const hs = /** @param {*} x @param {*} y */ (x, y) =>
    hash(
      x
        .mul(float(311.7))
        .add(y.mul(float(127.1)))
        .add(float(salt * 57.3 + 13))
    )
  return mix(mix(hs(x0, y0), hs(x0.add(1), y0), ux), mix(hs(x0, y0.add(1)), hs(x0.add(1), y0.add(1)), ux), uy)
}

/**
 * The flowing-sheet material. Unlit whitewater: two octaves of value noise stretched ~6:1 vertically
 * (streak read) scrolling DOWN at `scroll` × speed, a noise² whitewater ramp, top-lip brighten, bottom
 * fade into spray. Alpha carries translucency (< 0.85). Uniform-driven scroll (naga-safe). Shared
 * singleton across all sheets → one pipeline.
 * @param {*} scroll_uniform uniform(float) scroll-speed multiplier (tier)
 * @param {*} [sky_dim] uniform(float) sky day/night level (1 day → 0 night) — NIGHT DIM: an unlit sheet keeps
 *   its whitewater brightness regardless of scene light, so it glowed at night ("the water
 *   emits light"). Scaling the colour by the sky level makes the fall darken with the world; alpha is kept so
 *   it still occludes the voxel water behind it (a dark sheet, not a transparent one). Day ×1 = byte-identical.
 * @returns {MeshBasicNodeMaterial}
 */
export function create_sheet_material(scroll_uniform, sky_dim = uniform(1)) {
  const mat = new MeshBasicNodeMaterial()
  mat.transparent = true
  mat.depthWrite = false
  mat.side = DoubleSide // a thin water sheet reads from both sides; also immunises against a flipped face

  const a = /** @type {any} */ (attribute('aSheet', 'vec3'))
  const u = a.x // blocks along the run
  const v = a.y // 0 bottom → 1 top
  const h = a.z // span height, blocks

  mat.colorNode = Fn(() => {
    const vw = v.mul(h) // world-vertical in blocks (the 1:1 axis; ×6 below makes the 6:1 streak)
    const t = time.mul(scroll_uniform)
    // two scrolling octaves; vertical frequency ×6 the horizontal → tall thin streaks; scroll DOWN (−t).
    // scroll SPEED raised (1.6→2.2, 2.7→3.6) — a "static" read needs a clearly FAST fall.
    const n1 = sheet_noise(u.mul(float(0.7)), vw.mul(float(4.2)).sub(t.mul(float(2.2))), 0)
    const n2 = sheet_noise(u.mul(float(1.7)).add(float(3.1)), vw.mul(float(8.0)).sub(t.mul(float(3.6))), 1)
    const churn = n1.mul(float(0.6)).add(n2.mul(float(0.4)))
    const foam = churn.mul(churn) // noise² whitewater ramp — bright foamy filaments
    // CREST — the only place the sheet gets meaningfully whiter/more opaque than the general body. The
    // "impact" brightness comes from the separate foam disc + spray below, never from this alpha.
    const crest = smoothstep(float(0.82), float(1.0), v) // 0 through the body → 1 at the very top lip
    const rgb = vec3(...WHITEWATER)
      // 2026-07-12: SCROLLING whitewater filaments raised 0.16 → 0.34 — these move DOWN with the fall, so
      // making them read IS the motion cure (the old "static" read was a faint, near-invisible scroll).
      .add(vec3(...FOAM_WHITE).mul(foam.mul(float(0.34))))
      .add(crest.mul(float(0.22))) // crest brighten — subtler: a dense cascade stacks many crests in one view
    // vertical presence: full through the body, dissolving into the spray zone at the very base (v→0).
    const bottom_fade = smoothstep(float(0.0), float(0.18), v)
    // OPACITY (2026-07-12 — the sheet read as static transparent cubes with a glassy shine; transparency
    // needed to drop way down to high alpha). The prior translucent body (0.42-0.57) let the glassy voxel water behind dominate.
    // RAISED to a genuinely occluding aerated sheet (0.68-0.90) so the mirror-shiny voxel water is hidden and
    // the fall reads as milky whitewater. The 2026-07-11 "white walls" regression is prevented STRUCTURALLY by
    // the MIN_SHEET_H=3 gate (terraces get no sheet) + the fast downward MOTION (a moving sheet reads as a
    // fall, a static one as a wall); the base tint stays blue-white, not pure white. depthWrite stays off.
    const body_alpha = churn.mul(float(0.22)).add(float(0.68)) // 0.68 .. 0.90 — opaque aerated whitewater
    const crest_alpha = crest.mul(float(0.1)) // small extra at the lip; body is already opaque now
    const alpha = bottom_fade.mul(body_alpha.add(crest_alpha)) // ≤1: (0.90 body + 0.10 crest)·bottom_fade
    return vec4(rgb.mul(sky_dim), alpha) // NIGHT DIM colour only (alpha kept ⇒ still occludes, just dark)
  })()
  return mat
}

/**
 * Shared spray material. Basin origin/radius are per-object references, so every streamed basin uses
 * one pipeline without losing its own placement inputs. @param {*} [sky_dim] uniform(float) sky day/night
 * level (NIGHT DIM — see create_sheet_material). @returns {SpriteNodeMaterial}
 */
function create_spray_material(sky_dim = uniform(1)) {
  const mat = new SpriteNodeMaterial()
  mat.transparent = true
  mat.depthWrite = false

  const origin = reference('userData.spray_origin', 'vec3')
  const spread = reference('userData.spray_radius.value', 'float')
  const fi = float(instanceIndex)
  const seed = hash(fi.add(float(0.13)))
  const seed2 = hash(fi.add(float(7.7)))
  const rate = float(0.8).add(seed.mul(float(0.9)))
  const phase = fract(time.mul(rate).add(seed)) // life ∈ [0,1)
  // radial launch direction from two hashes (unit-ish), outward drift grows with life.
  const ang = seed2.mul(float(Math.PI * 2))
  const dir = vec2(ang.cos(), ang.sin())
  const arc = phase.mul(float(Math.PI)).sin() // 0→1→0 rise/fall
  const size = float(0.04).add(seed.mul(float(0.04))) // smaller droplets (2026-07-12 — droplets read as oversized puffs)
  // 2026-07-12 — read as a geyser: the arc rose ~2 blocks (arc·1.6 + phase·0.4) = a FOUNTAIN of
  // mid-air puffs. Impact spray hugs the waterline base — peak rise ~0.55 block, drift pulled in (×0.7).
  const pos = origin.add(
    vec3(
      dir.x.mul(spread).mul(phase).mul(float(0.7)),
      arc.mul(float(0.5)).add(phase.mul(float(0.12))),
      dir.y.mul(spread).mul(phase).mul(float(0.7))
    )
  )

  mat.positionNode = pos
  mat.scaleNode = size.mul(float(1).sub(phase.mul(float(0.3))))
  const cam_d = length(cameraPosition.sub(pos))
  const near = float(1).sub(smoothstep(float(SPRAY_FADE_NEAR), float(SPRAY_FADE_FAR), cam_d))
  const life_fade = float(1)
    .sub(phase)
    .mul(smoothstep(float(0), float(0.15), phase)) // fade in + out
  mat.colorNode = vec4(vec3(...FOAM_WHITE).mul(sky_dim), life_fade.mul(near).mul(float(0.42))) // NIGHT DIM colour

  return mat
}

/** @param {Basin} basin @param {number} count @param {PlaneGeometry} geometry @param {SpriteNodeMaterial} material */
function create_spray(basin, count, geometry, material) {
  const mesh = new InstancedMesh(geometry, material, count)
  mesh.userData.spray_origin = new Vector3(...basin.pos)
  mesh.userData.spray_radius = { value: basin.radius }
  mesh.frustumCulled = false // billboards move in-shader; the CPU bounds are wrong
  return mesh
}

/**
 * Shared basin-foam material: a radial-scroll whitewater decal over the impact point.
 * @param {*} [sky_dim] uniform(float) sky day/night level (NIGHT DIM). @returns {MeshBasicNodeMaterial}
 */
function create_foam_material(sky_dim = uniform(1)) {
  const mat = new MeshBasicNodeMaterial()
  mat.transparent = true
  mat.depthWrite = false
  mat.side = DoubleSide
  // CircleGeometry UVs run 0..1; centre at (0.5,0.5). Radial foam noise scrolling outward + rim fade.
  const uv = /** @type {any} */ (attribute('uv', 'vec2'))
  const c = uv.sub(vec2(0.5, 0.5))
  const r = length(c).mul(float(2)) // 0 centre → 1 rim
  mat.colorNode = Fn(() => {
    const n = sheet_noise(uv.x.mul(float(9)), uv.y.mul(float(9)).sub(time.mul(float(1.2))), 2)
    const ring = smoothstep(float(0.15), float(0.6), r).mul(float(1).sub(smoothstep(float(0.7), float(1.0), r)))
    const alpha = ring.mul(n.mul(float(0.5)).add(float(0.3))).mul(float(0.4)) // 2026-07-12: subtler foam patch
    return vec4(vec3(...FOAM_WHITE).mul(sky_dim), alpha) // NIGHT DIM colour
  })()
  return mat
}

/** @param {Basin} basin @param {CircleGeometry} geometry @param {MeshBasicNodeMaterial} material */
function create_foam(basin, geometry, material) {
  // 2026-07-12 — billboard discs read as huge: the disc spanned radius×1.6 (a wide halo). Shrunk to ×0.85 —
  // roughly the impact footprint at the waterline, a subtle patch rather than a painted-white plate.
  const mesh = new Mesh(geometry, material)
  mesh.scale.setScalar(basin.radius * 0.85)
  mesh.position.set(basin.pos[0], basin.pos[1] + 0.05, basin.pos[2])
  return mesh
}

// ── the system (ring-hook lifecycle) ────────────────────────────────────────────────────────────────
/**
 * @typedef {object} WaterfallSystem
 * @property {(coord: [number,number,number]) => void} note_load ring on_chunk_loaded hook (cx,cy,cz)
 * @property {(coord: [number,number,number]) => void} note_unload ring on_chunk_unloaded hook
 * @property {() => { columns: number, sheets: number, sprays: number }} stats live counts (bench)
 * @property {() => () => void} mount_pipeline_warmers mounts the exact finite material set for this tier
 * @property {(sun_y: number) => void} set_sky_dim NIGHT DIM: set the sky day/night level from the sun
 *   elevation (sun_direction.y); engine.js calls it per tod so the unlit falls darken at night.
 * @property {() => void} dispose release every group + GPU buffer
 */
/**
 * Create the waterfall overlay system. Builds a per-column group (sheet + tier-gated spray/foam) on the
 * first resident cy of a column, refcount-disposes on the last. `get_spans(cx,cz)` returns the column's
 * FallSpans (world_gen.world_fall_spans; injected so tests pass a fake).
 * @param {{ scene: any, tier: TierName, get_spans: (cx:number,cz:number) => FallSpan[] }} o
 * @returns {WaterfallSystem}
 */
export function create_waterfall_system({ scene, tier, get_spans }) {
  const scroll = uniform(scroll_speed_for(tier))
  // NIGHT DIM (fixes unlit whitewater that kept glowing at night). One shared sky
  // day/night uniform (1 day → 0 below the horizon) scales every sheet/spray/foam colour; engine.js drives it
  // per tod via set_sky_dim off the live sun elevation (same signal the near water uses — sky_day_factor).
  const sky_dim = uniform(1)
  const sheet_material = create_sheet_material(scroll, sky_dim)
  const spray_count = spray_count_for(tier)
  const want_foam = foam_enabled_for(tier)
  const spray_geometry = spray_count > 0 ? new PlaneGeometry(1, 1) : null
  const spray_material = spray_count > 0 ? create_spray_material(sky_dim) : null
  const foam_geometry = want_foam ? new CircleGeometry(1, 16) : null
  foam_geometry?.rotateX(-Math.PI / 2)
  const foam_material = want_foam ? create_foam_material(sky_dim) : null
  const shared_resources = new Set(
    [sheet_material, spray_geometry, spray_material, foam_geometry, foam_material].filter(Boolean)
  )
  /** @typedef {{ refs: number, group: any | null, sprays: number }} Entry */
  /** @type {Map<string, Entry>} */
  const columns = new Map()
  /** @type {Set<() => void>} */
  const warmer_releases = new Set()
  let disposed = false

  /** @param {number} cx @param {number} cz @returns {Entry} */
  function build(cx, cz) {
    const spans = get_spans(cx, cz)
    const { geometry, quad_count } = build_sheet_geometry(spans)
    if (quad_count === 0) {
      geometry.dispose()
      return { refs: 1, group: null, sprays: 0 } // no sheets — remember to skip recompute
    }
    const group = new Group()
    group.name = `falls_${cx}_${cz}`
    const sheet = new Mesh(geometry, sheet_material)
    sheet.frustumCulled = false // spans across a chunk; per-chunk cull is cheap enough to skip
    group.add(sheet)
    let sprays = 0
    for (const basin of select_basins(spans, tier)) {
      if (spray_geometry && spray_material) {
        group.add(create_spray(basin, spray_count, spray_geometry, spray_material))
        sprays += 1
      }
      if (foam_geometry && foam_material) group.add(create_foam(basin, foam_geometry, foam_material))
    }
    scene.add(group)
    return { refs: 1, group, sprays }
  }

  /** @param {any} group */
  function dispose_group(group) {
    if (!group) return
    scene.remove(group)
    group.traverse(
      /** @param {any} o */ (o) => {
        if (o.geometry && !shared_resources.has(o.geometry)) o.geometry.dispose?.()
        if (o.material && !shared_resources.has(o.material)) o.material.dispose?.()
      }
    )
  }

  return {
    note_load([cx, , cz]) {
      if (disposed) return
      const key = `${cx},${cz}`
      const e = columns.get(key)
      if (e) {
        e.refs += 1
        return
      }
      columns.set(key, build(cx, cz))
    },
    note_unload([cx, , cz]) {
      if (disposed) return
      const key = `${cx},${cz}`
      const e = columns.get(key)
      if (!e) return
      e.refs -= 1
      if (e.refs > 0) return
      dispose_group(e.group)
      columns.delete(key)
    },
    stats() {
      let sheets = 0
      let sprays = 0
      for (const e of columns.values()) {
        if (e.group) sheets += 1
        sprays += e.sprays
      }
      return { columns: columns.size, sheets, sprays }
    },
    mount_pipeline_warmers() {
      if (disposed) return () => {}
      const { geometry } = build_sheet_geometry([
        /** @type {FallSpan} */ ({ x0: 0, x1: 0, z0: 0, z1: 0, y_top: MIN_SHEET_H, y_bot: 0, face: FACE_PX, width: 1 }),
      ])
      const group = new Group()
      group.name = `falls_pipeline_warmers_${tier}`
      group.add(new Mesh(geometry, sheet_material))
      const basin = /** @type {Basin} */ ({ pos: [0, 0, 0], radius: 1 })
      if (spray_geometry && spray_material) group.add(create_spray(basin, spray_count, spray_geometry, spray_material))
      if (foam_geometry && foam_material) group.add(create_foam(basin, foam_geometry, foam_material))
      for (const child of group.children) child.frustumCulled = false
      scene.add(group)

      let released = false
      const release = () => {
        if (released) return
        released = true
        warmer_releases.delete(release)
        scene.remove(group)
        geometry.dispose()
      }
      warmer_releases.add(release)
      return release
    },
    set_sky_dim(sun_y) {
      sky_dim.value = sky_day_factor(sun_y)
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const release of [...warmer_releases]) release()
      for (const e of columns.values()) dispose_group(e.group)
      columns.clear()
      for (const resource of shared_resources) resource.dispose()
    },
  }
}
