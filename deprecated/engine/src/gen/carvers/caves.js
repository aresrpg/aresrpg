// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Cave carver family (§4.5 NG1-B, item 5) — the deterministic, region-local cave systems that
// subtract density through density.js's existing cave seam. Three carvers:
//
//   SPAGHETTI — a single ridged crest network > threshold opens winding near-surface tunnels (moved
//               here verbatim from density.js; cave mouths on canyon/cliff walls).
//   WORLEY    — cellular caverns at DEPTH: where the distance to the nearest jittered feature point
//               (F1) is small, a room opens. These are marked as CAVERN ROOMS in chunk meta so the
//               future cave decorator (glow mushrooms — NOT this lane) can find them.
//   WORMS     — poisson-ish jittered cave MOUTHS at the land surface, each spawning a bounded,
//               trig-free random-walk that carves a winding tunnel guaranteed to reach the surface.
//               Built once per 8×8-chunk REGION (deterministic from region coords + seed), cached,
//               and XZ-binned so a per-voxel query tests only nearby segments — region-local +
//               bounded (DO-NOT #11: no unbounded stateful walk that a neighbor query must replay).
//
// DETERMINISM LAW (§3.7): arithmetic + Math.floor/abs/min/max/sqrt + integer bit-ops/Math.imul ONLY
// (bit-ops are exact 32-bit, like world_config's BigInt mixing — NOT the banned transcendentals).
// The region cache is a pure memo of a deterministic build → two contexts yield identical worlds.

import { REGION_SIZE_CHUNKS, CHUNK_SIZE, HARD_FLOOR_Y } from '../../config/world_config.js'
import { create_ridged_sampler } from '../noise/ridged.js'
import { create_fbm_sampler } from '../noise/sampler.js'
import { hash3 } from '../noise/integer_hash.js'

const REGION_BLOCKS = REGION_SIZE_CHUNKS * CHUNK_SIZE // 256
/** Deepest a cave (worm/worley) may carve — density's band_low floor for cave-region columns. */
export const DEEP_CAVE_FLOOR = HARD_FLOOR_Y + 1
/** Worm-cache region cap. Eviction runs only at a per-column boundary (never mid-priming), so a
 *  column always keeps its just-primed 3×3 regions; a cleared region rebuilds identically. */
const CAVE_REGION_CACHE_CAP = 96

// ---- CAVERN-ROOM META CONVENTION (documented for the future cave decorator — glow mushrooms) -----
// A worley cavern ROOM is marked in the chunk's `biome` meta array (the 8×8×8 per-4×4×4-cell channel,
// chunks/format.js) by OR-ing the high bit onto the cell's biome byte. Convention:
//   biome id      = meta_byte & CAVERN_ROOM_META_MASK   (low 7 bits)
//   is cavern room = (meta_byte & CAVERN_ROOM_META_FLAG) !== 0   (bit 7)
// Safe because every biome id is < 128 (biome_registry) and nothing reads chunk.biome downstream yet
// (verified). The future cave decorator (NOT this lane) scatters glow mushrooms in flagged cells.
/** High bit OR-ed onto a meta biome byte to mark a 4×4×4 cell as inside a worley cavern room. */
export const CAVERN_ROOM_META_FLAG = 0x80
/** Low-7-bit mask to recover the biome id from a (possibly cavern-flagged) meta byte. */
export const CAVERN_ROOM_META_MASK = 0x7f

/** Cave recipe (const world-recipe — moving these forks the world, §4). */
export const CAVES_CONFIG = {
  spaghetti: { period: 88, octaves: 2, threshold: 0.9, depth: 40, depth_min: 3, depth_max: 34 },
  /** 2D cave-REGION mask: worley caverns + worm mouths only exist where this low-freq field is high
   *  (localized cave systems, ~12% of area) so the expensive deep evaluation is paid on few columns. */
  region: { period: 640, octaves: 3, threshold: 0.62 },
  /** Worley caverns: cell size, feature radius (fraction of cell), and the absolute depth band. */
  worley: { cell: 46, radius: 0.36, y_min: HARD_FLOOR_Y + 6, y_max: 96, carve: 46 },
  /** Worms: jittered mouths on a grid; each walks a bounded winding tunnel down from the surface. */
  worms: {
    mouth_cell: 74, // one candidate mouth per this-size XZ cell in a region
    mouth_chance: 0.5, // fraction of candidate cells that actually spawn a mouth
    steps: 34, // walk steps per worm (bounded)
    step_len: 5.5, // blocks per step
    radius: 2.6, // tunnel radius
    carve: 60, // density subtracted at a tunnel core
    y_floor: HARD_FLOOR_Y + 3, // worms never dive below this
    bin: 16, // XZ bin size for segment lookup
  },
}

/**
 * @typedef {object} WormSegment
 * @property {number} x0 @property {number} y0 @property {number} z0
 * @property {number} x1 @property {number} y1 @property {number} z1
 */

/**
 * @typedef {object} CaveCarver
 * @property {import('../noise/ridged.js').RidgedSampler} spaghetti
 * @property {import('../noise/sampler.js').FbmSampler} region 2D cave-region mask
 * @property {number} seed base carver seed (for worley + worm hashing)
 * @property {Map<number, WormSegment[]>} bins GLOBAL worm segments binned by XZ cell (border-correct:
 *   a worm crossing a region edge is found by voxels on both sides, unlike per-region caches)
 * @property {Set<string>} primed regions whose worms are already baked into `bins`
 */

/**
 * Builds the cave carver from the `carvers` sub-seed (distinct salts from density/erosion/canyon).
 * @param {Record<string, number>} seeds output of `derive_world_seeds`
 * @returns {CaveCarver}
 */
export function create_cave_carver(seeds) {
  const carve = seeds.carvers >>> 0
  return {
    spaghetti: create_ridged_sampler({
      seed: carve ^ 0x3333_3333, // unchanged from density.js so the near-surface tunnels are stable
      base_period: CAVES_CONFIG.spaghetti.period,
      octaves: CAVES_CONFIG.spaghetti.octaves,
    }),
    region: create_fbm_sampler({
      seed: carve ^ 0xd00d_2b2b,
      base_period: CAVES_CONFIG.region.period,
      octaves: CAVES_CONFIG.region.octaves,
    }),
    seed: carve,
    bins: new Map(),
    primed: new Set(),
  }
}

/**
 * Bounds the worm-segment cache — clears it once the primed-region count exceeds the cap. MUST be
 * called only at a per-column BOUNDARY (before a column primes its 3×3 regions), never mid-priming,
 * so a column never loses a region it just primed. Deterministic: worms are a pure function of region
 * coords, so a cleared region rebuilds identically on next demand — this bounds memory, not the world.
 * @param {CaveCarver} cc
 * @returns {void}
 */
export function evict_caves_if_full(cc) {
  if (cc.primed.size > CAVE_REGION_CACHE_CAP) {
    cc.primed.clear()
    cc.bins.clear()
  }
}

/**
 * Whether a column sits in a cave REGION — i.e. deep worley caverns + worm tunnels exist under it.
 * Cheap (one 2D fbm sample), gates the expensive deep-cave evaluation to ~12% of columns.
 * @param {CaveCarver} cc @param {number} x @param {number} z
 * @returns {boolean}
 */
export function cave_region_at(cc, x, z) {
  return cc.region.sample(x, z) > CAVES_CONFIG.region.threshold
}

/**
 * The density fast-path FLOOR (lowest world-y where a cave can carve, so density.js keeps everything
 * below it a cheap solid heightfield). Deep to bedrock on cave-region columns (worley/worm reach
 * there); just under the spaghetti crust otherwise.
 * @param {number} surface_y effective surface world-y
 * @param {boolean} deep whether this column is a cave region
 * @returns {number}
 */
export function cave_band_low(surface_y, deep) {
  if (deep) return DEEP_CAVE_FLOOR
  const floor = surface_y - CAVES_CONFIG.spaghetti.depth_max
  return floor > DEEP_CAVE_FLOOR ? floor : DEEP_CAVE_FLOOR
}

// ---- Integer hashing (exact 32-bit, deterministic — §3.7) ---------------------------------------

// hash3 imported from ../noise/integer_hash.js (shared determinism-pinned home).

/** Hash → float in [0,1). @param {number} h uint32 @returns {number} */
function to_unit(h) {
  return (h >>> 0) * 2.3283064365386963e-10 // 2^-32
}

// ---- Worley caverns at depth --------------------------------------------------------------------

/**
 * Worley F1 (distance to the nearest jittered feature point) at a voxel, searching the 3×3×3 cell
 * neighborhood. Deterministic (integer cell hashing). Only meaningful inside the worley depth band.
 * @param {CaveCarver} cc @param {number} x @param {number} y @param {number} z
 * @returns {number} nearest-feature distance in blocks
 */
function worley_f1(cc, x, y, z) {
  const { cell } = CAVES_CONFIG.worley
  const cx = Math.floor(x / cell)
  const cy = Math.floor(y / cell)
  const cz = Math.floor(z / cell)
  let best = 1e9
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const gx = cx + dx
        const gy = cy + dy
        const gz = cz + dz
        // One hash per cell; derive 3 decorrelated jitter components from it (cheap re-mixes).
        const h = hash3(gx, gy, gz, cc.seed ^ 0xcafe_1234)
        const fx = (gx + to_unit(h)) * cell
        const fy = (gy + to_unit(Math.imul(h ^ 0x9e37_79b1, 0x85eb_ca6b) >>> 0)) * cell
        const fz = (gz + to_unit(Math.imul(h ^ 0xc2b2_ae35, 0x27d4_eb2f) >>> 0)) * cell
        const ex = fx - x
        const ey = fy - y
        const ez = fz - z
        const d2 = ex * ex + ey * ey + ez * ez
        if (d2 < best) best = d2
      }
    }
  }
  return Math.sqrt(best)
}

/**
 * Whether a voxel sits inside a worley cavern ROOM (open + deep). Also the meta-marker predicate.
 * @param {CaveCarver} cc @param {number} x @param {number} y @param {number} z
 * @returns {boolean}
 */
export function cavern_room_at(cc, x, y, z) {
  const w = CAVES_CONFIG.worley
  if (y < w.y_min || y > w.y_max) return false
  return worley_f1(cc, x, y, z) < w.cell * w.radius
}

// ---- Worms: region-cached bounded walkers -------------------------------------------------------

/**
 * Bakes one 8×8-chunk region's worms into the GLOBAL bins (idempotent — tracked by `primed`). Mouths
 * are jittered per grid cell in cave regions, started at the land surface (via the caller's probe);
 * each walks a bounded winding tunnel. Segments are binned by GLOBAL XZ cell, so a worm crossing the
 * region edge is found by voxels on either side. Callers prime the 3×3 region neighborhood of a chunk
 * so every worm reaching into it is present. Deterministic ⇒ the bins are a pure memo (§3.7).
 * @param {CaveCarver} cc
 * @param {number} region_x @param {number} region_z
 * @param {(wx: number, wz: number) => number} surface_probe land surface world-y at a column
 * @returns {void}
 */
export function prime_region(cc, region_x, region_z, surface_probe) {
  const key = `${region_x},${region_z}`
  if (cc.primed.has(key)) return
  cc.primed.add(key)

  const wc = CAVES_CONFIG.worms
  const base_x = region_x * REGION_BLOCKS
  const base_z = region_z * REGION_BLOCKS
  const cells = Math.ceil(REGION_BLOCKS / wc.mouth_cell)
  /** @type {WormSegment[]} */
  const segments = []

  for (let mz = 0; mz < cells; mz += 1) {
    for (let mx = 0; mx < cells; mx += 1) {
      const h0 = hash3(region_x * 131 + mx, 777, region_z * 131 + mz, cc.seed ^ 0x1eaf_1eaf)
      if (to_unit(h0) > wc.mouth_chance) continue // sparse mouths
      // Mouth position (jittered within its cell) + start just under the land surface.
      const jx = to_unit(hash3(mx, 11, mz, cc.seed ^ 0x0bad_c0de))
      const jz = to_unit(hash3(mx, 13, mz, cc.seed ^ 0x0fee_dbad))
      const start_x = base_x + (mx + jx) * wc.mouth_cell
      const start_z = base_z + (mz + jz) * wc.mouth_cell
      if (!cave_region_at(cc, Math.floor(start_x), Math.floor(start_z))) continue // cave regions only
      const start_y = surface_probe(Math.floor(start_x), Math.floor(start_z)) - 2
      walk_worm(cc, segments, start_x, start_y, start_z, h0)
    }
  }
  for (const seg of segments) bin_add(cc, seg)
}

/**
 * Walks one bounded worm from a mouth, appending segments. Trig-free: a running direction vector is
 * perturbed by hashed jitter and renormalized (sqrt only), biased gently downward then leveling.
 * @param {CaveCarver} cc @param {WormSegment[]} out
 * @param {number} sx @param {number} sy @param {number} sz @param {number} seed0
 * @returns {void}
 */
function walk_worm(cc, out, sx, sy, sz, seed0) {
  const wc = CAVES_CONFIG.worms
  let x = sx
  let y = sy
  let z = sz
  // Initial direction: mostly downward into the crust.
  let dx = to_unit(hash3(seed0 | 0, 1, 0, cc.seed)) - 0.5
  let dy = -0.6
  let dz = to_unit(hash3(seed0 | 0, 0, 1, cc.seed)) - 0.5
  for (let s = 0; s < wc.steps; s += 1) {
    // Perturb direction with fresh hashed jitter; ease the downward bias toward level with depth.
    dx += to_unit(hash3(seed0 | 0, s, 2, cc.seed ^ 0x55)) - 0.5
    dy += to_unit(hash3(seed0 | 0, s, 3, cc.seed ^ 0xaa)) - 0.5 - 0.08
    dz += to_unit(hash3(seed0 | 0, s, 4, cc.seed ^ 0xff)) - 0.5
    let len = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (len < 1e-4) len = 1
    dx /= len
    dy /= len
    dz /= len
    const nx = x + dx * wc.step_len
    let ny = y + dy * wc.step_len
    const nz = z + dz * wc.step_len
    if (ny < wc.y_floor) {
      ny = wc.y_floor
      dy = Math.abs(dy) * 0.5 // bounce off the floor, start leveling/rising
    }
    out.push({ x0: x, y0: y, z0: z, x1: nx, y1: ny, z1: nz })
    x = nx
    y = ny
    z = nz
  }
}

/** Bin key from a global XZ cell (16-bit wrap is ample for a streamed neighborhood). */
function bin_key(/** @type {number} */ bx, /** @type {number} */ bz) {
  return (bx & 0xffff) | ((bz & 0xffff) << 16)
}

/** Adds a segment to the global bins under both endpoints' XZ cells. */
function bin_add(/** @type {CaveCarver} */ cc, /** @type {WormSegment} */ seg) {
  const { bin } = CAVES_CONFIG.worms
  const push = (/** @type {number} */ bx, /** @type {number} */ bz) => {
    const k = bin_key(bx, bz)
    let arr = cc.bins.get(k)
    if (!arr) cc.bins.set(k, (arr = []))
    if (!arr.includes(seg)) arr.push(seg)
  }
  push(Math.floor(seg.x0 / bin), Math.floor(seg.z0 / bin))
  push(Math.floor(seg.x1 / bin), Math.floor(seg.z1 / bin))
}

/**
 * Worm carve depth (blocks, ≥0) at a voxel — distance to the nearest worm segment, ramped so the
 * tunnel core carves fully and the edge fades. Reads only the voxel's XZ bin + neighbors from the
 * GLOBAL bins (region must be primed via prime_region; unprimed area ⇒ 0, which keeps density()
 * self-consistent in unit tests that never prime).
 * @param {CaveCarver} cc @param {number} x @param {number} y @param {number} z
 * @returns {number} carve depth in blocks
 */
export function worm_carve(cc, x, y, z) {
  const wc = CAVES_CONFIG.worms
  if (cc.bins.size === 0) return 0
  const bx = Math.floor(x / wc.bin)
  const bz = Math.floor(z / wc.bin)
  let best2 = 1e9
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const arr = cc.bins.get(bin_key(bx + dx, bz + dz))
      if (!arr) continue
      for (const seg of arr) {
        const d2 = point_segment_d2(x, y, z, seg)
        if (d2 < best2) best2 = d2
      }
    }
  }
  if (best2 >= wc.radius * wc.radius) return 0
  const t = 1 - Math.sqrt(best2) / wc.radius
  return t * t * wc.carve
}

/** Squared distance from a point to a worm segment. @returns {number} */
function point_segment_d2(
  /** @type {number} */ px,
  /** @type {number} */ py,
  /** @type {number} */ pz,
  /** @type {WormSegment} */ s
) {
  const vx = s.x1 - s.x0
  const vy = s.y1 - s.y0
  const vz = s.z1 - s.z0
  const wx = px - s.x0
  const wy = py - s.y0
  const wz = pz - s.z0
  const vv = vx * vx + vy * vy + vz * vz
  let t = vv > 0 ? (wx * vx + wy * vy + wz * vz) / vv : 0
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const ex = wx - t * vx
  const ey = wy - t * vy
  const ez = wz - t * vz
  return ex * ex + ey * ey + ez * ez
}

/**
 * Total cave carve density to SUBTRACT at a voxel: spaghetti (near-surface, everywhere) + worley
 * caverns + worms (both DEEP, gated to cave-region columns via `deep`). Called from density.js
 * inside the active cave band; `deep` is the column's precomputed cave_region_at flag (so the
 * per-voxel hot path skips the expensive worley/worm work on the ~88% of non-cave columns).
 * @param {CaveCarver} cc @param {number} x @param {number} y @param {number} z
 * @param {number} surface_y the column's effective surface (for near-surface spaghetti gating)
 * @param {boolean} deep whether this column is a cave region (worley + worms active)
 * @returns {number} density to subtract (≥0)
 */
export function cave_carve(cc, x, y, z, surface_y, deep) {
  let sub = 0
  const sp = CAVES_CONFIG.spaghetti
  const depth = surface_y - y
  if (depth >= sp.depth_min && depth <= sp.depth_max) {
    const v = cc.spaghetti.sample(x, y, z)
    if (v > sp.threshold) sub += ((v - sp.threshold) / (1 - sp.threshold)) * sp.depth
  }
  if (!deep) return sub
  const w = CAVES_CONFIG.worley
  if (y >= w.y_min && y <= w.y_max) {
    const f1 = worley_f1(cc, x, y, z)
    const r = w.cell * w.radius
    if (f1 < r) sub += (1 - f1 / r) * w.carve
  }
  const wm = CAVES_CONFIG.worms
  if (y >= wm.y_floor && depth >= 2) sub += worm_carve(cc, x, y, z)
  return sub
}
