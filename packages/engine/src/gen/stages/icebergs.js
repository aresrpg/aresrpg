// ICEBERG PLACER stage (FIVE-WORLDS §P3 shared stage 4 — Everest oceans). Buoyant ICE masses floating in
// below-sea columns — the sky-island region-gate technique INVERTED and anchored at sea level: the world
// XZ plane is tiled into `region_size` cells; a hashed fraction (`region_rate`) are ICEBERG regions, each
// scattering `blobs_min..max` lens-shaped ice blobs at hashed positions + radii. A blob is a dome whose
// horizontal radius `r` tapers its vertical extent: `freeboard·r` of ICE rides ABOVE the waterline and
// `draft·r` of PACKED_ICE hangs BELOW (the keel). Purely arithmetic + integer-hash (same lineage as
// sky_islands.js), region-memoized, region-local. Off by default (enabled:false) ⇒ byte-identical DEFAULT.
//
// DETERMINISM LAW (§3.7): Math.imul integer hashing + Math.floor/abs/sqrt only. No sin/cos/pow/random.

import { get_block_by_name } from '../../config/block_registry.js'
import { hash2, hash3 } from '../noise/integer_hash.js'

/** @typedef {import('../../config/world_gen_config.js').IcebergConfig} IcebergConfig */

const REGION_CACHE_CAP = 64

// hash2 / hash3 imported from ../noise/integer_hash.js (shared determinism-pinned home).
/** @param {number} h @returns {number} [0,1) */
function to_unit(h) {
  return (h >>> 0) * 2.3283064365386963e-10
}

/**
 * @typedef {object} Iceberg one placed ice blob.
 * @property {number} cx world-x of the axis @property {number} cz world-z of the axis @property {number} r horizontal radius
 */

/**
 * @typedef {object} IcebergContext resolved iceberg stage.
 * @property {boolean} enabled stage on (config enabled AND ice ids resolved)
 * @property {number} seed decorrelated sub-seed @property {IcebergConfig} cfg the world's iceberg recipe
 * @property {number} sea_level the waterline the blobs anchor at @property {number} ice_id above-waterline block
 * @property {number} packed_id below-waterline keel block @property {number} y_low lowest possible ice world-y
 * @property {number} y_high highest possible ice world-y @property {number} reach max blob radius (region-scan margin)
 * @property {Map<number, Iceberg[]>} region_cache region → blobs memo (pure fn of region+seed)
 */

/**
 * Builds the iceberg stage context from the `carvers` sub-seed + a world's `icebergs` recipe and the sea
 * level. Ice ids are resolved by name (feature-detected — a bundle without them disables the stage).
 * @param {Record<string, number>} seeds output of derive_world_seeds
 * @param {IcebergConfig} [cfg] @param {number} [sea_level]
 * @returns {IcebergContext}
 */
export function create_iceberg_context(seeds, cfg, sea_level = 128) {
  const ice_id = get_block_by_name('ice')?.id
  const packed_id = get_block_by_name('packed_ice')?.id ?? ice_id
  const c = cfg ?? {
    enabled: false,
    region_size: 384,
    region_rate: 0.22,
    blobs_min: 2,
    blobs_max: 6,
    radius_min: 8,
    radius_max: 24,
    freeboard: 0.35,
    draft: 0.9,
  }
  return {
    enabled: c.enabled === true && ice_id !== undefined,
    seed: ((seeds.carvers >>> 0) ^ 0x1ceb_e12e) >>> 0,
    cfg: c,
    sea_level,
    ice_id: /** @type {number} */ (ice_id),
    packed_id: /** @type {number} */ (packed_id),
    y_low: sea_level - Math.ceil(c.radius_max * c.draft) - 1,
    y_high: sea_level + Math.ceil(c.radius_max * c.freeboard) + 1,
    reach: c.radius_max,
    region_cache: new Map(),
  }
}

/** Whether region (rx,rz) hosts icebergs. @param {IcebergContext} ic @param {number} rx @param {number} rz @returns {boolean} */
function is_iceberg_region(ic, rx, rz) {
  return to_unit(hash2(rx, rz, (ic.seed ^ 0x1b1c_e001) >>> 0)) < ic.cfg.region_rate
}

/**
 * Materializes a region's iceberg blobs (deterministic pure function of region + seed). Blobs are scattered
 * at hashed offsets inside an inset margin (so a cluster reads as one field, not smeared to the cell edges).
 * @param {IcebergContext} ic @param {number} rx @param {number} rz @returns {Iceberg[]}
 */
function build_region(ic, rx, rz) {
  /** @type {Iceberg[]} */
  const out = []
  if (!is_iceberg_region(ic, rx, rz)) return out
  const { cfg } = ic
  const base_x = rx * cfg.region_size
  const base_z = rz * cfg.region_size
  const count =
    cfg.blobs_min + Math.floor(to_unit(hash2(rx, rz, (ic.seed ^ 0x0ce_a1) >>> 0)) * (cfg.blobs_max - cfg.blobs_min + 1))
  const inset = cfg.radius_max
  const span = Math.max(1, cfg.region_size - 2 * inset)
  for (let i = 0; i < count; i += 1) {
    const salt = (ic.seed ^ Math.imul(i + 1, 0x9e37_79b1)) >>> 0
    const ox = to_unit(hash3(rx, rz, i, (salt ^ 0x00a1) >>> 0)) * span + inset
    const oz = to_unit(hash3(rx, rz, i, (salt ^ 0x00b2) >>> 0)) * span + inset
    const r = cfg.radius_min + to_unit(hash3(rx, rz, i, (salt ^ 0x00c3) >>> 0)) * (cfg.radius_max - cfg.radius_min)
    out.push({ cx: Math.floor(base_x + ox), cz: Math.floor(base_z + oz), r })
  }
  return out
}

/** Region blobs, memoized (bounded — a pure fn of region+seed, so clearing is world-neutral).
 * @param {IcebergContext} ic @param {number} rx @param {number} rz @returns {Iceberg[]} */
function cached_region(ic, rx, rz) {
  const key = ((rx & 0xffff) | ((rz & 0xffff) << 16)) >>> 0
  let list = ic.region_cache.get(key)
  if (list === undefined) {
    if (ic.region_cache.size >= REGION_CACHE_CAP)
      ic.region_cache.delete(/** @type {number} */ (ic.region_cache.keys().next().value))
    list = build_region(ic, rx, rz)
    ic.region_cache.set(key, list)
  }
  return list
}

/**
 * The ice block a blob places at a voxel, or -1 for none. Lens dome: horizontal falloff `horiz` (1 at axis
 * → 0 at rim) scales the vertical half-extents, so the mass is fat at the centre and thins to the rim; ICE
 * above the waterline (freeboard·r·horiz), PACKED_ICE below (draft·r·horiz — the keel).
 * @param {IcebergContext} ic @param {Iceberg} b @param {number} x @param {number} y @param {number} z @returns {number}
 */
function blob_block(ic, b, x, y, z) {
  const dx = x - b.cx
  const dz = z - b.cz
  const rh2 = dx * dx + dz * dz
  if (rh2 > b.r * b.r) return -1
  const horiz = 1 - Math.sqrt(rh2) / b.r // 1 axis → 0 rim
  if (horiz <= 0) return -1
  const dy = y - ic.sea_level
  const up = b.r * ic.cfg.freeboard * horiz
  const down = b.r * ic.cfg.draft * horiz
  if (dy > up || dy < -down) return -1
  return dy < 0 ? ic.packed_id : ic.ice_id
}

/**
 * The iceberg block id at a world voxel, or -1 for none. Region-gated (empty regions cost one hash + memo)
 * then the max over the covering region's blobs, plus a neighbor region only when within `reach` of a
 * boundary (region_size > 2·reach ⇒ at most one neighbor per axis). Callers cheap-reject the y band +
 * ocean column FIRST, so this only fires on the thin waterline shell of below-sea columns.
 * @param {IcebergContext} ic @param {number} x @param {number} y @param {number} z @returns {number} block id or -1
 */
export function iceberg_block(ic, x, y, z) {
  if (!ic.enabled) return -1
  const rsize = ic.cfg.region_size
  const { reach } = ic
  const rx = Math.floor(x / rsize)
  const rz = Math.floor(z / rsize)
  let best = -1
  const scan = (/** @type {number} */ grx, /** @type {number} */ grz) => {
    const list = cached_region(ic, grx, grz)
    for (let i = 0; i < list.length; i += 1) {
      const blk = blob_block(ic, list[i], x, y, z)
      if (blk >= 0) best = blk
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
