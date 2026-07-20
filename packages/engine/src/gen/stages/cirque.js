// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// CIRQUE SCOOP stage (GLACIAL GENERATION §B.2). Carves amphitheater bowls into high ridge heads (ref R4 —
// ref_cirque_basecamp IS one): a flat floor, a steep encircling headwall, and a subtle raised lip at the
// rim. Cirque centres are scattered by the region-hash technique (same integer-hash lineage as
// icebergs/sky_islands), but placement is GATED on altitude — when a region is first materialized each
// candidate centre probes the pre-cirque land surface and is kept only if it sits above `min_altitude`, so
// bowls only scoop real high terrain (no half-cirques on lowland). The carve is a radial depth subtracted
// from the land surface in raw_land. Off by default ⇒ zero carve ⇒ byte-identical DEFAULT world.
//
// DETERMINISM LAW (§3.7): Math.imul integer hashing + Math.floor/abs/sqrt only. No sin/cos/pow/random.

import { hash2, hash3 } from '../noise/integer_hash.js'

/** @typedef {import('../../config/world_gen_config.js').CirqueConfig} CirqueConfig */

const REGION_CACHE_CAP = 64

// hash2 / hash3 imported from ../noise/integer_hash.js (shared determinism-pinned home).
/** @param {number} h @returns {number} [0,1) */
function to_unit(h) {
  return (h >>> 0) * 2.3283064365386963e-10
}

/**
 * @typedef {object} Cirque one placed amphitheater bowl.
 * @property {number} cx world-x of the centre @property {number} cz world-z of the centre @property {number} r rim radius
 */

/**
 * @typedef {object} CirqueContext resolved cirque stage.
 * @property {boolean} enabled stage on
 * @property {number} seed decorrelated sub-seed @property {CirqueConfig} cfg the world's cirque recipe
 * @property {number} min_altitude land-y a centre must exceed to host a cirque
 * @property {number} reach max rim radius (region-scan margin, blocks)
 * @property {Map<number, Cirque[]>} region_cache region → bowls memo (pure fn of region+seed+terrain)
 */

/**
 * Builds the cirque stage context from the carvers sub-seed + a world's `cirque` recipe. Disabled ⇒
 * enabled:false. The region cache stores bowls keyed by region (a pure fn of region+seed+the probed
 * terrain, so bounded eviction is world-neutral).
 * @param {CirqueConfig} [cfg]
 * @param {Record<string, number>} [seeds] output of derive_world_seeds
 * @returns {CirqueContext}
 */
export function create_cirque_context(cfg, seeds) {
  const c = cfg ?? {
    enabled: false,
    region_size: 256,
    region_rate: 0.5,
    per_region: 2,
    radius_min: 26,
    radius_max: 60,
    depth: 34,
    floor_ratio: 0.35,
    lip: 3,
    min_altitude: 180,
  }
  return {
    enabled: c.enabled === true,
    seed: ((seeds?.carvers ?? 0) >>> 0) ^ (0xc19_2e00 >>> 0),
    cfg: c,
    min_altitude: c.min_altitude ?? 180,
    reach: (c.radius_max ?? 60) + (c.lip ?? 0),
    region_cache: new Map(),
  }
}

/**
 * Materializes a region's cirque bowls (deterministic pure fn of region + seed + probed terrain). Each
 * candidate centre is hashed to a position + radius inside an inset margin, then KEPT only if the pre-cirque
 * land surface there exceeds `min_altitude` (so bowls only scoop high ridges). `land_probe(x,z)` returns the
 * land-y WITHOUT the cirque carve (raw_land minus this stage), so there is no recursion.
 * @param {CirqueContext} qc @param {number} rx @param {number} rz @param {(x:number,z:number)=>number} land_probe
 * @returns {Cirque[]}
 */
function build_region(qc, rx, rz, land_probe) {
  /** @type {Cirque[]} */
  const out = []
  const { cfg } = qc
  if (to_unit(hash2(rx, rz, (qc.seed ^ 0x0c19_0001) >>> 0)) >= cfg.region_rate) return out
  const base_x = rx * cfg.region_size
  const base_z = rz * cfg.region_size
  const inset = cfg.radius_max
  const span = Math.max(1, cfg.region_size - 2 * inset)
  for (let i = 0; i < cfg.per_region; i += 1) {
    const salt = (qc.seed ^ Math.imul(i + 1, 0x9e37_79b1)) >>> 0
    const ox = to_unit(hash3(rx, rz, i, (salt ^ 0x00a1) >>> 0)) * span + inset
    const oz = to_unit(hash3(rx, rz, i, (salt ^ 0x00b2) >>> 0)) * span + inset
    const r = cfg.radius_min + to_unit(hash3(rx, rz, i, (salt ^ 0x00c3) >>> 0)) * (cfg.radius_max - cfg.radius_min)
    const cx = Math.floor(base_x + ox)
    const cz = Math.floor(base_z + oz)
    if (land_probe(cx, cz) < qc.min_altitude) continue // altitude gate — high ridges only
    out.push({ cx, cz, r })
  }
  return out
}

/** Region bowls, memoized (bounded — pure fn of region+seed+terrain, so clearing is world-neutral).
 * @param {CirqueContext} qc @param {number} rx @param {number} rz @param {(x:number,z:number)=>number} land_probe @returns {Cirque[]} */
function cached_region(qc, rx, rz, land_probe) {
  const key = ((rx & 0xffff) | ((rz & 0xffff) << 16)) >>> 0
  let list = qc.region_cache.get(key)
  if (list === undefined) {
    if (qc.region_cache.size >= REGION_CACHE_CAP)
      qc.region_cache.delete(/** @type {number} */ (qc.region_cache.keys().next().value))
    list = build_region(qc, rx, rz, land_probe)
    qc.region_cache.set(key, list)
  }
  return list
}

/**
 * One bowl's carve depth (blocks) at a column: full `depth` on the flat inner floor (d ≤ floor_ratio·r),
 * a smoothstep headwall across [floor_ratio·r, r], and a subtle NEGATIVE carve (raised lip) just outside
 * the rim over `lip` blocks. Radial + deterministic.
 * @param {CirqueContext} qc @param {Cirque} b @param {number} x @param {number} z @returns {number} carve depth (can be <0 at the lip)
 */
function bowl_carve(qc, b, x, z) {
  const dx = x - b.cx
  const dz = z - b.cz
  const d = Math.sqrt(dx * dx + dz * dz)
  const floor_r = b.r * qc.cfg.floor_ratio
  if (d <= floor_r) return qc.cfg.depth
  if (d < b.r) {
    const t = (b.r - d) / (b.r - floor_r) // 1 at floor edge → 0 at rim
    return qc.cfg.depth * (t * t * (3 - 2 * t)) // smoothstep headwall
  }
  const lip = qc.cfg.lip ?? 0
  if (lip > 0 && d < b.r + lip) {
    const t = (b.r + lip - d) / lip // 1 at rim → 0 at lip outer edge
    return -lip * (t * t * (3 - 2 * t)) * 0.5 // small raised lip (negative carve)
  }
  return 0
}

/**
 * Cirque carve depth (blocks) at a world column — the max bowl carve over the covering region + any
 * neighbor region within `reach` of a boundary. `land_probe(x,z)` is raw_land WITHOUT this stage (the
 * altitude gate at build time). Returns 0 when disabled. Can be slightly negative at a rim lip.
 * @param {CirqueContext} qc @param {number} x @param {number} z @param {(x:number,z:number)=>number} land_probe
 * @returns {number} carve depth in blocks (0 when disabled)
 */
export function cirque_carve(qc, x, z, land_probe) {
  if (!qc.enabled) return 0
  const rsize = qc.cfg.region_size
  const { reach } = qc
  const rx = Math.floor(x / rsize)
  const rz = Math.floor(z / rsize)
  let best = 0
  const scan = (/** @type {number} */ grx, /** @type {number} */ grz) => {
    const list = cached_region(qc, grx, grz, land_probe)
    for (let i = 0; i < list.length; i += 1) {
      const c = bowl_carve(qc, list[i], x, z)
      if (c > best || (best === 0 && c < 0)) best = c
    }
  }
  scan(rx, rz)
  const lx = x - rx * rsize
  const lz = z - rz * rsize
  const sx = lx < reach ? -1 : lx > rsize - reach ? 1 : 0
  const sz = lz < reach ? -1 : lz > rsize - reach ? 1 : 0
  if (sx !== 0) scan(rx + sx, rz)
  if (sz !== 0) scan(rx, rz + sz)
  if (sx !== 0 && sz !== 0) scan(rx + sx, rz + sz)
  return best
}
