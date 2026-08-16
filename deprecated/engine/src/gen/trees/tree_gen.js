// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PROCEDURAL TREE GENERATOR CORE (ENGINE AAA PLAN §3 — the centerpiece). Pure generation: a seed + a
// species record → a deterministic voxel skeleton + sprite-leaf/branch-card placement, emitted as a
// synthesized `ResolvedSchematic` (loader.js:48-58 shape) so the EXISTING stamper/halo/grounding/clip
// pipeline places it UNCHANGED (§3.1: swap WHAT gets picked, not HOW it's placed). No render/ imports.
//
// ARCHITECTURE (§3.1, confirmed): parametric recursive-branching skeleton (integer L-system class) with
// hash-driven decisions. Space colonization is rejected on the gen path (float-heavy, cost-unbounded).
//
// DETERMINISM LAW (§3.2/§3.7) — restated as an invariant this file OBEYS:
//  • Integer / fixed-point (×256) math ONLY. The sole Math.* used are imul/floor/abs/min/max (all exact
//    and cross-machine — same allow-list as cave_room.js:22 / sky_islands.js). ZERO transcendentals:
//    no sin/cos/tan/pow/exp/log/random, no Date, no Float drift. The branch DIRECTION TABLE (YAW16/PITCH)
//    is PRECOMPUTED integer LITERALS (offline cos/sin, baked) — never a runtime trig call.
//  • Every growth decision comes from a splitmix32 stream (make_rng) seeded by hash5(seed^SALT_TREE_GEN,
//    wx, wz, branch_index, depth) — the same splitmix family / hash_column lineage as stamper.js:54-60.
//  • The function is PURE (no module mutable state): identical (seed,wx,wz,species) ⇒ byte-identical tree
//    on the gen worker AND the main thread. A golden test hashes N trees byte-exact (tree_gen.test.js).

import { get_block_by_id, get_block_by_name } from '../../config/block_registry.js'

import { AGE_BANDS, AGE_WEIGHTS, resolve_species } from './species.js'

/** @typedef {import('../schematics/loader.js').ResolvedSchematic} ResolvedSchematic */
/** @typedef {import('../schematics/loader.js').ResolvedVoxel} ResolvedVoxel */
/** @typedef {import('../schematics/loader.js').PlacementMode} PlacementMode */
/** @typedef {import('./species.js').SpeciesParams} SpeciesParams */

/** Decorrelated per-system salt folded with the world seed (same role as stamper's SALT_SELECT). */
export const SALT_TREE_GEN = 0x7a3b1c9d

const U32 = 0xffffffff

// ── Determinism primitives ──────────────────────────────────────────────────────────────────────

/**
 * 5-input integer hash → uint32 (splitmix lineage; NO transcendentals). Folds (seed, wx, wz,
 * branch_index, depth) into a well-distributed word — the branch-lineage extension of cave_room.hash3.
 * @param {number} a @param {number} b @param {number} c @param {number} d @param {number} e
 * @returns {number} uint32
 */
export function hash5(a, b, c, d, e) {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) & U32
  h = (h + Math.imul(c | 0, 2147483647)) & U32
  h = (h + Math.imul(d | 0, 1013904223)) & U32
  h = (h ^ Math.imul(e | 0, 0x9e3779b1)) & U32
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) & U32
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) & U32
  return (h ^ (h >>> 15)) >>> 0
}

/**
 * A splitmix32 PRNG stream (exact 32-bit integer ops via Math.imul — portable to the bit). Each call
 * returns the next uint32. Deterministic: same seed ⇒ same sequence on every JS engine.
 * @param {number} seed uint32
 * @returns {() => number}
 */
export function make_rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x9e3779b9) >>> 0
    let z = s
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0
    return (z ^ (z >>> 15)) >>> 0
  }
}

/** Inclusive integer in [lo,hi] from the stream. @param {()=>number} rng @param {number} lo @param {number} hi */
function ri(rng, lo, hi) {
  return hi <= lo ? lo : lo + (rng() % (hi - lo + 1))
}
/** Boolean with probability num/den. @param {()=>number} rng @param {number} num @param {number} den */
function rchance(rng, num, den) {
  return rng() % den < num
}
/** Weighted age roll (§3.3). @param {()=>number} rng @returns {'young'|'mature'|'ancient'} */
function pick_age(rng) {
  const r = rng() % 256
  let acc = 0
  for (const [name, w] of AGE_WEIGHTS) {
    acc += w
    if (r < acc) return name
  }
  return 'mature'
}
/** Truncate-toward-zero integer divide (b>0). Deterministic; keeps DDA drift symmetric across origin.
 *  @param {number} a @param {number} b @returns {number} */
function idiv(a, b) {
  return a < 0 ? -Math.floor(-a / b) : Math.floor(a / b)
}

// ── Precomputed integer direction table (§3.2) ───────────────────────────────────────────────────
// 16 yaw headings (22.5° steps) as [x,z] scaled ×16 = round(16·cos θ, 16·sin θ). Baked LITERALS — the
// offline trig, never a runtime call. 5 pitch bands as [horiz,vert] run-ratios (flat → near-vertical).

/** @type {ReadonlyArray<readonly [number, number]>} */
const YAW16 = [
  [16, 0],
  [15, 6],
  [11, 11],
  [6, 15],
  [0, 16],
  [-6, 15],
  [-11, 11],
  [-15, 6],
  [-16, 0],
  [-15, -6],
  [-11, -11],
  [-6, -15],
  [0, -16],
  [6, -15],
  [11, -11],
  [15, -6],
]
/** @type {ReadonlyArray<readonly [number, number]>} pitch bands: [horiz weight, vertical weight] */
const PITCH = [
  [16, 0], // 0 flat
  [15, 6], // 1 gentle (~21°)
  [12, 12], // 2 mid (45°)
  [8, 15], // 3 steep (~62°)
  [3, 16], // 4 near-vertical (~79°)
]

/**
 * Integer step direction for (yaw, pitch band, vertical sign). x/z scale = 16·pitch.horiz; y scale =
 * ±16·pitch.vert — balanced so a segment advances comparably on the dominant axis regardless of heading.
 * @param {number} yaw 0-15 @param {number} band 0-4 @param {number} sign +1 up / -1 down
 * @returns {[number, number, number]}
 */
function dir_vec(yaw, band, sign) {
  const y = YAW16[yaw & 15]
  const pb = PITCH[band < 0 ? 0 : band > 4 ? 4 : band]
  return [y[0] * pb[0], sign * pb[1] * 16, y[1] * pb[0]]
}

// ── Voxel accumulator (dedupe + priority) ────────────────────────────────────────────────────────
// One cell per (dx,dy,dz); a higher-priority kind wins (bark/cap 3 > leaf 2 > twig 1) so a later leaf
// never punches out a trunk. Base is CLAMPED to dy≥0 (schematic base sits ON surface_y; nothing below).

/**
 * @typedef {object} Palette resolved block references for a species' three material kinds (+ mushroom cap)
 * @property {ResolvedEntry|null} bark @property {ResolvedEntry|null} leaf @property {ResolvedEntry|null} twig
 * @property {ResolvedEntry|null} cap
 */
/** @typedef {{ block_id:number, solid:boolean, mode:PlacementMode, prio:number }} ResolvedEntry */
/** @typedef {{ cells: Map<number, ResolvedVoxel & {prio:number}>, pal: Palette }} TreeCtx */
/** @typedef {'bark'|'leaf'|'twig'|'cap'} Kind material selector into the palette */
/** @typedef {import('./species.js').AgeBand} AgeBand */

/**
 * Resolve a block NAME → a placement entry (id + solid + mode + priority), or null if absent (a null
 * species field, or a not-yet-registered block — the tree still generates, that kind is skipped).
 * `solid` mirrors loader.js: shape 'cross' ⇒ non-occupying foliage.
 * @param {string|null} name @param {PlacementMode} mode @param {number} prio @returns {ResolvedEntry|null}
 */
function res(name, mode, prio) {
  if (name === null) return null
  const b = get_block_by_name(name)
  if (b === undefined) return null
  const def = get_block_by_id(b.id)
  return { block_id: b.id, solid: def?.shape !== 'cross', mode, prio }
}

/** Build the four-slot palette for a species. @param {SpeciesParams} p @returns {Palette} */
function build_palette(p) {
  return {
    bark: res(p.bark, 'overwrite', 3),
    leaf: res(p.leaf, 'replace_foliage', 2),
    twig: res(p.twig, 'replace_foliage', 1),
    cap: res(p.leaf, 'overwrite', 3), // mushroom cap = the leaf-slot block, but structural (overwrite)
  }
}

// ── Per-worker scratch (ALLOCATION-CHURN kill, not a behavior change) ──────────────────────────────
// The generator runs SYNCHRONOUSLY, one tree at a time per worker (gen_worker.handle_message), so a
// single reusable accumulator suffices: build_tree .clear()s it at entry and finalize hands its VALUE
// objects straight to the schematic's voxels (no second per-voxel allocation). The palette is a pure
// function of the species record → memoized by object identity. These cut ~1492 string keys + ~1492
// duplicate voxel objects PER giant synthesis (measured: the OOM was that churn ×thousands of trees ×10
// gen workers), and change NOTHING in the output — the golden byte-hash (tree_gen.test.js) proves it.
/** @type {Map<number, ResolvedVoxel & {prio:number}>} */
const _scratch_cells = new Map()
/** @type {WeakMap<SpeciesParams, Palette>} */
const _palette_cache = new WeakMap()
/** Memoized palette for a species record (pure over the record + registry). @param {SpeciesParams} p @returns {Palette} */
function get_palette(p) {
  let pal = _palette_cache.get(p)
  if (pal === undefined) {
    pal = build_palette(p)
    _palette_cache.set(p, pal)
  }
  return pal
}

/** Pack an anchor-relative cell (dx,dy,dz) into a collision-free integer key (dy≥0; |dx|,|dz|≤reach≪512).
 *  Replaces the per-cell string key — pure churn, thousands per tree. Output-order-free (finalize sorts).
 *  @param {number} dx @param {number} dy @param {number} dz @returns {number} */
function cell_key(dx, dy, dz) {
  return ((dx + 512) * 1024 + (dz + 512)) * 1024 + dy
}

/**
 * Write one cell of `kind` at anchor-relative (dx,dy,dz), respecting dedupe priority and the dy≥0 floor.
 * On a priority UPGRADE the existing cell object is mutated in place (same dx,dy,dz — the key encodes
 * them), so only a genuinely NEW cell allocates. Byte-identical to the prior replace-with-new-object.
 * @param {TreeCtx} t @param {number} dx @param {number} dy @param {number} dz
 * @param {'bark'|'leaf'|'twig'|'cap'} kind
 */
function put(t, dx, dy, dz, kind) {
  if (dy < 0) return
  const e = t.pal[kind]
  if (e == null) return
  const key = cell_key(dx, dy, dz)
  const ex = t.cells.get(key)
  if (ex !== undefined) {
    if (ex.prio >= e.prio) return
    ex.block_id = e.block_id // upgrade in place (dx,dy,dz unchanged)
    ex.solid = e.solid
    ex.mode = e.mode
    ex.prio = e.prio
    return
  }
  t.cells.set(key, { dx, dy, dz, block_id: e.block_id, solid: e.solid, mode: e.mode, prio: e.prio })
}

/** Filled integer ball (dist² ≤ r²). r≤0 ⇒ a single cell.
 *  @param {TreeCtx} t @param {number} cx @param {number} cy @param {number} cz @param {number} r @param {Kind} kind */
function emit_ball(t, cx, cy, cz, r, kind) {
  if (r <= 0) {
    put(t, cx, cy, cz, kind)
    return
  }
  const r2 = r * r
  for (let dy = -r; dy <= r; dy += 1)
    for (let dx = -r; dx <= r; dx += 1)
      for (let dz = -r; dz <= r; dz += 1) if (dx * dx + dy * dy + dz * dz <= r2) put(t, cx + dx, cy + dy, cz + dz, kind)
}

/**
 * Leaf-cluster ellipsoid. `shell` keeps only the surface (a cell whose 6-neighbours aren't all inside)
 * so crowns stay hollow (§3.3: "interior stays hollow"; leaf_sprites renders exposed shells only).
 * @param {TreeCtx} t @param {number} cx @param {number} cy @param {number} cz
 * @param {number} rx @param {number} ry @param {number} rz @param {boolean} shell @param {Kind} kind
 */
function emit_cluster(t, cx, cy, cz, rx, ry, rz, shell, kind) {
  const rx2 = rx * rx
  const ry2 = ry * ry
  const rz2 = rz * rz
  const lim = rx2 * ry2 * rz2
  const inside = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) =>
    x * x * ry2 * rz2 + y * y * rx2 * rz2 + z * z * rx2 * ry2 <= lim
  for (let dy = -ry; dy <= ry; dy += 1)
    for (let dx = -rx; dx <= rx; dx += 1)
      for (let dz = -rz; dz <= rz; dz += 1) {
        if (!inside(dx, dy, dz)) continue
        if (
          shell &&
          inside(dx + 1, dy, dz) &&
          inside(dx - 1, dy, dz) &&
          inside(dx, dy + 1, dz) &&
          inside(dx, dy - 1, dz) &&
          inside(dx, dy, dz + 1) &&
          inside(dx, dy, dz - 1)
        )
          continue
        put(t, cx + dx, cy + dy, cz + dz, kind)
      }
}

/**
 * Upper-hemisphere dome (mushroom cap): (x²+z²)·ry² + y²·rxz² ≤ rxz²·ry², dy≥0. `shell` keeps only the
 * surface (+ the dy=0 gill ring); filled gives a chunky solid cap.
 * @param {TreeCtx} t @param {number} cx @param {number} cy @param {number} cz
 * @param {number} rxz @param {number} ry @param {Kind} kind @param {boolean} shell
 */
function emit_dome(t, cx, cy, cz, rxz, ry, kind, shell) {
  const rxz2 = rxz * rxz
  const ry2 = ry * ry
  const lim = rxz2 * ry2
  const inside = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) =>
    (x * x + z * z) * ry2 + y * y * rxz2 <= lim
  for (let dy = 0; dy <= ry; dy += 1)
    for (let dx = -rxz; dx <= rxz; dx += 1)
      for (let dz = -rxz; dz <= rxz; dz += 1) {
        if (!inside(dx, dy, dz)) continue
        if (
          shell &&
          dy !== 0 &&
          inside(dx + 1, dy, dz) &&
          inside(dx - 1, dy, dz) &&
          inside(dx, dy + 1, dz) &&
          inside(dx, dy - 1, dz) &&
          inside(dx, dy, dz + 1) &&
          inside(dx, dy, dz - 1)
        )
          continue
        put(t, cx + dx, cy + dy, cz + dz, kind)
      }
}

// ── Limb rasterizer (fixed-point 3D DDA) ─────────────────────────────────────────────────────────

/**
 * Rasterize a limb of `len` block-steps from (x0,y0,z0) along (yaw,band,sign), thickening each step into
 * a ball whose radius tapers r0→r1, with periodic ±1 yaw lattice curves every ~3 steps (§3.2 curve rule).
 * Fixed-point pen (×256), one ball per block on the dominant axis. Returns the tip cell.
 * @param {TreeCtx} t @param {()=>number} rng @param {number} x0 @param {number} y0 @param {number} z0
 * @param {number} yaw @param {number} band @param {number} sign @param {number} len @param {number} r0
 * @param {number} r1 @param {Kind} kind @returns {[number,number,number]}
 */
function grow_limb(t, rng, x0, y0, z0, yaw, band, sign, len, r0, r1, kind) {
  let cyaw = yaw & 15
  let [vx, vy, vz] = dir_vec(cyaw, band, sign)
  let m = Math.max(1, Math.abs(vx), Math.abs(vy), Math.abs(vz))
  let dX = idiv(vx * 256, m)
  let dY = idiv(vy * 256, m)
  let dZ = idiv(vz * 256, m)
  let X = (x0 << 8) + 128
  let Y = (y0 << 8) + 128
  let Z = (z0 << 8) + 128
  const span = Math.max(1, len - 1)
  for (let s = 0; s < len; s += 1) {
    if (s > 0 && s % 3 === 0) {
      cyaw = (cyaw + (rchance(rng, 128, 256) ? 1 : 15)) & 15 // ±1 lattice offset
      ;[vx, vy, vz] = dir_vec(cyaw, band, sign)
      m = Math.max(1, Math.abs(vx), Math.abs(vy), Math.abs(vz))
      dX = idiv(vx * 256, m)
      dY = idiv(vy * 256, m)
      dZ = idiv(vz * 256, m)
    }
    X += dX
    Y += dY
    Z += dZ
    const r = r1 + idiv((r0 - r1) * (span - s), span)
    emit_ball(t, X >> 8, Y >> 8, Z >> 8, r, kind)
  }
  return [X >> 8, Y >> 8, Z >> 8]
}

/**
 * Vertical trunk with lean + radius taper (trunk_r at base → r_top at the crown). Lean heading + magnitude
 * are hash-picked ≤ p.lean_max. Returns the trunk-tip cell (crown attaches there, lean-correct).
 * @param {TreeCtx} t @param {SpeciesParams} p @param {()=>number} rng @param {number} height
 * @param {number} r_top @param {Kind} kind @returns {[number,number,number]}
 */
function grow_trunk(t, p, rng, height, r_top, kind) {
  const lean = ri(rng, 0, p.lean_max)
  const yaw = ri(rng, 0, 15)
  const ly = YAW16[yaw]
  const vx = (ly[0] * lean) >> 4
  const vz = (ly[1] * lean) >> 4
  let X = 128
  let Y = 128
  let Z = 128
  const span = Math.max(1, height - 1)
  for (let s = 0; s < height; s += 1) {
    X += vx
    Y += 256
    Z += vz
    const r = r_top + idiv((p.trunk_r - r_top) * (span - s), span)
    emit_ball(t, X >> 8, Y >> 8, Z >> 8, r, kind)
  }
  return [X >> 8, Y >> 8, Z >> 8]
}

// ── Canopy helpers ───────────────────────────────────────────────────────────────────────────────

/** Place one leaf cluster (age shrinks young crowns; `flat` = umbrella/acacia pancake).
 *  @param {TreeCtx} t @param {SpeciesParams} p @param {()=>number} rng @param {number} x @param {number} y
 *  @param {number} z @param {AgeBand} age @param {boolean} flat */
function place_leaf(t, p, rng, x, y, z, age, flat) {
  if (t.pal.leaf === null) return
  let rx = ri(rng, p.blob_r_min, p.blob_r_max)
  let rz = ri(rng, p.blob_r_min, p.blob_r_max)
  if (age.crown < 200 && rchance(rng, 256 - age.crown, 256)) {
    rx = Math.max(1, rx - 1)
    rz = Math.max(1, rz - 1)
  }
  const ry = flat ? Math.max(1, rx - 1) : rx
  emit_cluster(t, x, y, z, rx, ry, rz, Math.max(rx, ry, rz) >= 3, 'leaf')
}

/** A branch-card twig at an outer tip (density from placement, not planes — D176).
 *  @param {TreeCtx} t @param {number} x @param {number} y @param {number} z */
function place_twig(t, x, y, z) {
  put(t, x, y, z, 'twig')
}

// ── Builders (one per form; silhouettes diverge by params) ───────────────────────────────────────

/**
 * Recursive broadleaf limb: rasterize, then either leaf out (depth 0) or fork into split_min..max
 * children with a yaw spread + a steeper pitch (spreading dome). Outer limbs also drop a lacework-gated
 * cluster. branch_index/depth thread the lineage but the shared stream already carries them.
 * @param {TreeCtx} t @param {SpeciesParams} p @param {()=>number} rng @param {number} x @param {number} y
 * @param {number} z @param {number} yaw @param {number} band @param {number} len @param {number} r
 * @param {number} depth @param {AgeBand} age
 */
function grow_crown_limb(t, p, rng, x, y, z, yaw, band, len, r, depth, age) {
  const tip = grow_limb(t, rng, x, y, z, yaw, band, 1, len, r, Math.max(0, r - 1), 'bark')
  if (depth <= 0) {
    place_leaf(t, p, rng, tip[0], tip[1], tip[2], age, p.crown_flat === true)
    place_twig(t, tip[0], tip[1], tip[2])
    return
  }
  const n = ri(rng, p.split_min ?? 2, p.split_max ?? 3)
  for (let i = 0; i < n; i += 1) {
    const off = ri(rng, -(p.split_spread ?? 2), p.split_spread ?? 2)
    const cyaw = (yaw + off + idiv(16 * i, Math.max(1, n))) & 15
    // Children climb toward vertical (band+2) so the dome gains HEIGHT, not runaway width — the reach
    // governor: crown radius stays ≈ the primary length (flat crowns get their spread from wide primaries
    // + flattened blobs, NOT from horizontal children, which would compound past crown_r).
    const cband = Math.min(4, band + 2)
    const clen = Math.max(2, idiv(len, 2))
    grow_crown_limb(t, p, rng, tip[0], tip[1], tip[2], cyaw, cband, clen, Math.max(1, r - 1), depth - 1, age)
  }
  if (depth === 1 && !rchance(rng, p.leaf_hole, 256))
    place_leaf(t, p, rng, tip[0], tip[1], tip[2], age, p.crown_flat === true)
}

/** @param {TreeCtx} t @param {SpeciesParams} p @param {()=>number} rng @param {AgeBand} age
 *  @param {number} H @param {boolean} broken */
function build_broadleaf(t, p, rng, age, H, broken) {
  const depth = p.split_depth ?? 2
  const fork_y = Math.max(2, idiv(H * (p.fork_frac ?? 150), 256))
  const tip = grow_trunk(t, p, rng, fork_y, Math.max(1, p.trunk_r - 1), 'bark')
  if (p.root_flare) {
    const rr = Math.max(1, p.trunk_r - 1)
    for (let k = 0; k < 4; k += 1) {
      const yaw = ri(rng, 0, 15)
      const ly = YAW16[yaw]
      emit_ball(t, (ly[0] * p.root_flare) >> 4, 0, (ly[1] * p.root_flare) >> 4, rr, 'bark')
    }
  }
  const primaries = ri(rng, p.split_min ?? 2, (p.split_max ?? 3) + 1)
  const y0 = ri(rng, 0, 15)
  // Primary length ≈ crown_r ⇒ horizontal reach ≈ crown_r. The crown is a radius-bounded dome atop the
  // bole, INDEPENDENT of trunk height — a 60-block pine and a 10-block oak keep an equally compact canopy.
  const clen = Math.max(3, (p.crown_r ?? 6) - 1)
  for (let i = 0; i < primaries; i += 1) {
    const pyaw = (y0 + idiv(16 * i, primaries) + ri(rng, -1, 1)) & 15
    const band = p.crown_flat ? 1 : 2 // flat=near-horizontal umbrella; else 45° radiating primaries
    grow_crown_limb(t, p, rng, tip[0], tip[1], tip[2], pyaw, band, clen, Math.max(1, p.trunk_r - 1), depth - 1, age)
  }
  if (!broken) place_leaf(t, p, rng, tip[0], tip[1] + 1, tip[2], age, p.crown_flat === true) // never-bald apex (snapped tops stay bare)
  if (p.mid_crowns) {
    const my = idiv(H * 3, 5)
    const ring = 5
    const yy = ri(rng, 0, 15)
    const rad = Math.max(2, p.crown_r - 3)
    for (let i = 0; i < ring; i += 1) {
      const a = (yy + idiv(16 * i, ring)) & 15
      const la = YAW16[a]
      place_leaf(t, p, rng, (la[0] * rad) >> 4, my, (la[1] * rad) >> 4, age, false)
    }
  }
}

/** @param {TreeCtx} t @param {SpeciesParams} p @param {()=>number} rng @param {AgeBand} age
 *  @param {number} H @param {boolean} broken */
function build_conifer(t, p, rng, age, H, broken) {
  const tip = grow_trunk(t, p, rng, H, 1, 'bark')
  const crown_base = Math.max(1, idiv(H * p.crown_start, 256))
  const span = Math.max(1, H - crown_base)
  let y = crown_base
  while (y < H - 1) {
    const blen = Math.max(2, idiv((p.crown_r ?? 6) * (H - y), span)) // conical: long at bottom
    const yaw0 = ri(rng, 0, 15)
    const branches = p.whorl_branches ?? 5
    for (let b = 0; b < branches; b += 1) {
      const byaw = (yaw0 + idiv(16 * b, branches)) & 15
      const bt = grow_limb(t, rng, 0, y, 0, byaw, p.whorl_droop ?? 1, -1, blen, 1, 0, 'bark')
      place_leaf(t, p, rng, bt[0], bt[1], bt[2], age, false)
      if (!rchance(rng, p.leaf_hole, 256))
        place_leaf(t, p, rng, idiv(bt[0], 2), idiv(y + bt[1], 2), idiv(bt[2], 2), age, false)
      place_twig(t, bt[0], bt[1], bt[2])
    }
    y += ri(rng, p.whorl_gap_min ?? 2, p.whorl_gap_max ?? 3)
  }
  if (!broken) place_leaf(t, p, rng, tip[0], tip[1], tip[2], age, false) // apex spire
  place_leaf(t, p, rng, tip[0], Math.max(0, tip[1] - 1), tip[2], age, false)
}

/** @param {TreeCtx} t @param {SpeciesParams} p @param {()=>number} rng @param {AgeBand} age @param {number} H */
function build_palm(t, p, rng, age, H) {
  const tip = grow_trunk(t, p, rng, H, 1, 'bark') // curved-ish leaning stem (high lean_max)
  const fronds = ri(rng, 6, 9)
  const y0 = ri(rng, 0, 15)
  const flen = Math.max(3, p.crown_r ?? 6)
  for (let f = 0; f < fronds; f += 1) {
    const fyaw = (y0 + idiv(16 * f, fronds)) & 15
    // Fronds grow as LEAF, not 'twig': a palm has no branch skeleton, so twig-card stems (dead_branch,
    // no occupancy) had nothing to hang on — 53% floated detached. As leaf the frond is one green
    // palm_leaves blade radiating from the crown. Same cells (count/reach hold), only the block id moves.
    const ft = grow_limb(t, rng, tip[0], tip[1], tip[2], fyaw, 2, 1, flen, 1, 0, 'leaf')
    place_leaf(t, p, rng, ft[0], ft[1], ft[2], age, true) // frond blade tip
  }
  place_leaf(t, p, rng, tip[0], tip[1] + 1, tip[2], age, true) // crown heart
}

/** @param {TreeCtx} t @param {SpeciesParams} p @param {()=>number} rng @param {AgeBand} age @param {number} H */
function build_mushroom(t, p, rng, age, H) {
  const tip = grow_trunk(t, p, rng, H, Math.max(1, p.trunk_r - 1), 'bark')
  const cr = Math.max(3, (p.crown_r ?? 5) - 1 + ri(rng, 0, 1))
  emit_dome(t, tip[0], tip[1], tip[2], cr, Math.max(2, idiv(cr * 3, 5)), 'cap', false) // filled chunky cap
}

// ── Finalize + public API ────────────────────────────────────────────────────────────────────────

/**
 * Turn the accumulated cells into a ResolvedSchematic carrying the FLAT COMPACT voxel form (loader.js
 * `CompactVoxels` — P0 balloon fix 2026-07-11). Cells are canonically sorted (dy,dz,dx) for a stable byte
 * order, THEN written into Int16 positions + a Uint8 palette index over a ≤4-entry shared palette:
 * ~7 B/voxel instead of ~72-100 B/voxel objects, so the decorator's 512-entry tree memo retains ~10 MB
 * per worker realm instead of ~100 MB (the measured OOM driver — every gen/far worker holds its own memo).
 * Consumers iterate via loader.js `for_each_voxel` in this SAME order, so stamped world bytes and the
 * frozen tree golden hash are IDENTICAL to the old object-array form. `size[1]` = maxdy+1 (the FULL
 * height — the decorator's vertical span early-out reads it, understating bald-tops upper chunks).
 * @param {SpeciesParams} p @param {import('./species.js').AgeBand} age @param {TreeCtx} t
 * @returns {ResolvedSchematic}
 */
function finalize(p, age, t) {
  // Sort the scratch map's cells canonically; the cell objects die with the next tree's .clear() — only
  // the compact arrays below survive into the schematic (the retention win).
  const cells = [...t.cells.values()]
  cells.sort((a, b) => a.dy - b.dy || a.dz - b.dz || a.dx - b.dx)
  const n = cells.length
  const pos = new Int16Array(n * 3)
  const pal = new Uint8Array(n)
  /** @type {{ block_id: number, solid: boolean, mode: import('../schematics/loader.js').PlacementMode }[]} */
  const palette = []
  /** @type {Map<string, number>} palette dedupe: (block_id|solid|mode) → palette index (≤4 entries/tree) */
  const pal_index = new Map()
  let minx = 0
  let minz = 0
  let maxx = 0
  let maxy = 0
  let maxz = 0
  let reach = 0
  for (let i = 0; i < n; i += 1) {
    const c = cells[i]
    pos[i * 3] = c.dx
    pos[i * 3 + 1] = c.dy
    pos[i * 3 + 2] = c.dz
    const key = `${c.block_id}|${c.solid ? 1 : 0}|${c.mode}`
    let pi = pal_index.get(key)
    if (pi === undefined) {
      pi = palette.length
      palette.push({ block_id: c.block_id, solid: c.solid, mode: c.mode })
      pal_index.set(key, pi)
    }
    pal[i] = pi
    if (c.dx < minx) minx = c.dx
    if (c.dx > maxx) maxx = c.dx
    if (c.dz < minz) minz = c.dz
    if (c.dz > maxz) maxz = c.dz
    if (c.dy > maxy) maxy = c.dy
    const rr = Math.max(Math.abs(c.dx), Math.abs(c.dz))
    if (rr > reach) reach = rr
  }
  return {
    name: `${p.key}:${age.name}`,
    category: /** @type {'tree'} */ ('tree'),
    size: /** @type {[number,number,number]} */ ([maxx - minx + 1, maxy + 1, maxz - minz + 1]),
    anchor: /** @type {[number,number,number]} */ ([0, 0, 0]),
    compact: { pos, pal, palette },
    reach,
    water_anchor: false,
  }
}

/**
 * Build a tree from an EXPLICIT age band, pulling every decision from `rng`. The generator dispatch —
 * exported for tests / silhouette dumps that force a specific age (production uses generate_tree, which
 * derives age from the hash). Applies age height-scale + the ancient broken-top snap.
 * @param {string|SpeciesParams} species @param {()=>number} rng @param {'young'|'mature'|'ancient'} age_name
 * @returns {ResolvedSchematic}
 */
export function build_tree(species, rng, age_name) {
  const p = resolve_species(species)
  const age = AGE_BANDS[age_name]
  _scratch_cells.clear() // reuse the per-worker accumulator (synchronous, one tree at a time)
  /** @type {TreeCtx} */
  const t = { cells: _scratch_cells, pal: get_palette(p) }
  let H = Math.max(3, idiv(ri(rng, p.h_min, p.h_max) * age.scale, 256))
  const broken = age.broken > 0 && rchance(rng, age.broken, 256)
  if (broken) H = Math.max(3, idiv(H * 82, 100))
  switch (p.form) {
    case 'conifer':
      build_conifer(t, p, rng, age, H, broken)
      break
    case 'palm':
      build_palm(t, p, rng, age, H)
      break
    case 'mushroom':
      build_mushroom(t, p, rng, age, H)
      break
    default:
      build_broadleaf(t, p, rng, age, H, broken)
  }
  return finalize(p, age, t)
}

/**
 * THE PUBLIC GEN ENTRY (§3.5): a seed + world column + species → a synthesized ResolvedSchematic the
 * stamper places unchanged. Pure & deterministic: age and every growth decision derive from the
 * hash5(seed^SALT_TREE_GEN, wx, wz, …) stream, so the same args yield a byte-identical tree everywhere.
 * @param {number} seed world seed @param {number} wx anchor column x @param {number} wz anchor column z
 * @param {string|SpeciesParams} species species key or params
 * @returns {ResolvedSchematic}
 */
export function generate_tree(seed, wx, wz, species) {
  const rng = make_rng(hash5((seed ^ SALT_TREE_GEN) >>> 0, wx, wz, 0, 0))
  const age = pick_age(rng)
  return build_tree(species, rng, age)
}
