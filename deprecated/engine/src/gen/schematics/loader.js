// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Schematic loader (§4.6 vegetation/schematics wave, phase A) — reads the compact house-format
// bundle shipped at assets/schematics/schematics.json (produced by scripts/convert_schematics.mjs
// from the aresrpg-legacy Sponge `.schem` packs) and resolves each entry into a runtime schematic
// whose voxels carry ANCHOR-RELATIVE offsets + registry block ids + a per-voxel placement mode.
//
// The bundle is imported (not fs-read) so it inlines under the vite/worker bundler for phase B and
// still resolves under `bun test` / tsc (resolveJsonModule). House entry shape (see converter):
//   { category, size:[W,H,L], anchor:[ax,ay,az], palette:[baseName...], voxels:[x,y,z,idx...] }
// voxels are sparse (air already dropped) and local; loader converts to offsets from `anchor` so
// the stamper only adds a world position (+ rotation) at placement time.

import bundle from '../../../assets/schematics/schematics.json' with { type: 'json' }
import { get_block_by_id, get_block_by_name } from '../../config/block_registry.js'

import { map_block_name } from './registry_map.js'

/** @typedef {import('./registry_map.js').MappingTier} MappingTier */

/** @typedef {'tree'|'rock'} SchematicCategory */
/**
 * Placement mode per voxel (how it interacts with whatever already occupies the target cell):
 * - `overwrite`: always write (structural core — trunks, rock body).
 * - `air_only`: write only into air.
 * - `replace_foliage`: write into air OR an existing foliage-class block (canopy that eats grass
 *   tufts but never gouges solid terrain or its own trunk). Leaves use this.
 * @typedef {'overwrite'|'air_only'|'replace_foliage'} PlacementMode
 */

/**
 * @typedef {object} RawSchematic house-format bundle entry
 * @property {SchematicCategory} category
 * @property {[number, number, number]} size [width(x), height(y), length(z)]
 * @property {[number, number, number]} anchor [ax, ay(base), az] placement pivot
 * @property {string[]} palette non-air base block names, index-aligned to voxel palette indices
 * @property {number[]} voxels flat [x, y, z, paletteIndex, ...] local, non-air
 */

/**
 * @typedef {object} ResolvedVoxel a schematic voxel as an offset from the anchor
 * @property {number} dx x offset from anchor (pre-rotation)
 * @property {number} dy y offset from anchor (base at 0)
 * @property {number} dz z offset from anchor (pre-rotation)
 * @property {number} block_id resolved registry block id
 * @property {boolean} solid occupancy-bearing (sets mesher occupancy bits when placed)
 * @property {PlacementMode} mode cell-interaction policy
 */

/**
 * @typedef {object} CompactVoxels the FLAT typed-array voxel carrier (synthesized trees — P0 balloon fix
 *   2026-07-11). An object-per-voxel array cost ~72-100 B/voxel; a big synthesized canopy (~2600 voxels)
 *   was ~192 KB, and the tree memo (surface_decorator, 512 entries) retained ~100 MB in EVERY gen-graph
 *   worker realm — the measured OOM driver. This form is ~7 B/voxel (Int16 xyz + Uint8 palette index +
 *   a ≤4-entry shared palette): the same tree is ~18 KB. Iteration order (= the generator's canonical
 *   (dy,dz,dx) sort) is preserved exactly, so stamped world bytes are IDENTICAL to the object form.
 * @property {Int16Array} pos [dx,dy,dz] per voxel, 3 entries each, canonical order
 * @property {Uint8Array} pal palette index per voxel (aligned with pos/3)
 * @property {{ block_id: number, solid: boolean, mode: PlacementMode }[]} palette distinct entries (≤4/tree)
 */

/**
 * @typedef {object} ResolvedSchematic
 * @property {string} name
 * @property {SchematicCategory} category
 * @property {[number, number, number]} size
 * @property {[number, number, number]} anchor
 * @property {ResolvedVoxel[]} [voxels] anchor-relative, registry-resolved (bundle schematics; absent on
 *   synthesized trees, which carry `compact` instead — consume via `for_each_voxel`, never `.voxels` directly)
 * @property {CompactVoxels} [compact] flat typed-array voxels (synthesized trees; absent on bundle schematics)
 * @property {number} reach max horizontal |offset| (chunks within this many columns can be reached)
 * @property {boolean} water_anchor FIVE-WORLDS: true iff a member of a `water_anchor_pools` pool — the
 *   schematic may anchor at the SEABED of a below-sea column (roots flooded, canopy above water). The
 *   surface decorator permits its underwater anchor; the stamper's `overwrite` voxels write through water.
 */

/**
 * Iterate a schematic's voxels regardless of carrier form (object `voxels` for bundle schematics, flat
 * `compact` typed arrays for synthesized trees) in the SAME canonical order either way. The callback gets
 * scalars + the SHARED palette entry — zero per-voxel allocation on the compact path (do not retain the
 * entry ref across trees; it is shared by design and immutable in practice).
 * @param {ResolvedSchematic} schematic
 * @param {(dx: number, dy: number, dz: number, entry: { block_id: number, solid: boolean, mode: PlacementMode }) => void} fn
 */
export function for_each_voxel(schematic, fn) {
  const { compact } = schematic
  if (compact) {
    const { pos, pal, palette } = compact
    const n = pal.length
    for (let i = 0; i < n; i += 1) fn(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], palette[pal[i]])
    return
  }
  for (const v of schematic.voxels ?? []) fn(v.dx, v.dy, v.dz, v)
}

/** Voxel count of either carrier form. @param {ResolvedSchematic} schematic @returns {number} */
export function voxel_count(schematic) {
  return schematic.compact ? schematic.compact.pal.length : (schematic.voxels?.length ?? 0)
}

// Leaves get `replace_foliage`; every other resolved solid is structural `overwrite`. Keyed by
// resolved block NAME so it tracks the registry, not a hard-coded id. D164: all three leaf variants
// (broadleaf/conifer/dry) are canopy → replace_foliage.
const FOLIAGE_PLACEMENT_NAMES = new Set(['leaves', 'leaves_conifer', 'leaves_dry'])

// D164 SET-LEVEL LEAF FALLBACK — when a schematic's NAME marks a biome whose canopy is species-typed
// but a leaf palette entry resolved to the GENERIC broadleaf `leaves` (id 7) via the keyword ruleset
// (e.g. a future generic-`leaves` conifer/savanna tree), remap it to the biome variant. Species-explicit
// palettes (spruce_leaves→conifer, acacia_leaves→dry) already resolved correctly and are UNCHANGED —
// this only catches generic broadleaf entries in a typed set. Prefix-matched against the SET name.
/** @type {{ prefixes: string[], name: string }[]} */
const SET_LEAF_FALLBACK = [
  // Taiga/arctic evergreen forests → conifer needled canopy.
  { prefixes: ['TAIGA', 'ARCTIC'], name: 'leaves_conifer' },
  // Desert/savanna arid → dry straw canopy.
  { prefixes: ['DESERT', 'SAVANNA'], name: 'leaves_dry' },
]

/**
 * The set-level leaf remap target for a schematic name, or null if none applies. Only ever upgrades a
 * GENERIC broadleaf `leaves` entry to a biome variant (the caller gates on the resolved name being
 * 'leaves'); species-explicit palettes never reach the gate. Pure prefix match on the schematic name.
 * @param {string} schematic_name @returns {string | null}
 */
function set_leaf_target(schematic_name) {
  for (const rule of SET_LEAF_FALLBACK) {
    if (rule.prefixes.some((p) => schematic_name.startsWith(p))) return rule.name
  }
  return null
}

/**
 * Resolves a raw bundle entry into a runtime schematic (block ids + offsets + modes precomputed).
 * @param {string} name
 * @param {RawSchematic} raw
 * @returns {ResolvedSchematic}
 */
export function resolve_schematic(name, raw) {
  const [ax, ay, az] = raw.anchor
  // D164: a typed biome set (taiga/arctic → conifer, desert/savanna → dry) upgrades a GENERIC broadleaf
  // `leaves` palette entry to its biome variant. Species-explicit palettes already resolved and are left
  // alone (the gate below only fires when the keyword ruleset produced plain 'leaves'). Resolved once.
  const set_leaf_name = set_leaf_target(name)
  /** palette index → resolved { block_id, block_name, solid, mode } */
  const resolved_palette = raw.palette.map((base) => {
    const mapping = map_block_name(base)
    let { block_id, block_name } = mapping
    if (set_leaf_name !== null && block_name === 'leaves') {
      // Generic broadleaf entry in a species-typed set → the biome leaf variant.
      block_id = /** @type {number} */ (get_block_by_name(set_leaf_name)?.id ?? block_id)
      block_name = set_leaf_name
    }
    const def = get_block_by_id(block_id)
    // shape 'cross' blocks carry no occupancy; every other class is occupancy-bearing (solid).
    const solid = def?.shape !== 'cross'
    /** @type {PlacementMode} */
    const mode = FOLIAGE_PLACEMENT_NAMES.has(block_name) ? 'replace_foliage' : 'overwrite'
    return { block_id, solid, mode }
  })

  const voxels = []
  let reach = 0
  for (let i = 0; i < raw.voxels.length; i += 4) {
    const x = raw.voxels[i]
    const y = raw.voxels[i + 1]
    const z = raw.voxels[i + 2]
    const p = resolved_palette[raw.voxels[i + 3]]
    const dx = x - ax
    const dz = z - az
    voxels.push({ dx, dy: y - ay, dz, block_id: p.block_id, solid: p.solid, mode: p.mode })
    const r = Math.max(Math.abs(dx), Math.abs(dz))
    if (r > reach) reach = r
  }

  return { name, category: raw.category, size: raw.size, anchor: raw.anchor, voxels, reach, water_anchor: false }
}

/** Lazily-resolved cache of the whole bundle (resolution is pure, do it once). */
let _all = /** @type {Map<string, ResolvedSchematic> | null} */ (null)

/**
 * The set of schematic names that may WATER-ANCHOR: every member of a pool named in the bundle's
 * `water_anchor_pools` list (FIVE-WORLDS Everglades mangroves). Empty when the bundle declares none.
 * @returns {Set<string>}
 */
function water_anchor_names() {
  /** @type {Set<string>} */
  const names = new Set()
  const wa_pools = /** @type {string[]} */ (/** @type {unknown} */ (bundle.water_anchor_pools) ?? [])
  const pools = /** @type {Record<string, string[]>} */ (/** @type {unknown} */ (bundle.pools) ?? {})
  for (const pool of wa_pools) for (const n of pools[pool] ?? []) names.add(n)
  return names
}

/**
 * All schematics in the bundle, resolved and memoized, keyed by name.
 * @returns {Map<string, ResolvedSchematic>}
 */
export function load_all_schematics() {
  if (_all) return _all
  const map = new Map()
  const wa = water_anchor_names()
  const entries = /** @type {Record<string, RawSchematic>} */ (/** @type {unknown} */ (bundle.schematics))
  for (const [name, raw] of Object.entries(entries)) {
    const s = resolve_schematic(name, raw)
    s.water_anchor = wa.has(name)
    map.set(name, s)
  }
  _all = map
  return map
}

/**
 * The resolved schematics of one category as an array — the "schematic set" the stamper picks from.
 * @param {SchematicCategory} category
 * @returns {ResolvedSchematic[]}
 */
export function load_schematic_set(category) {
  const out = []
  for (const s of load_all_schematics().values()) if (s.category === category) out.push(s)
  return out
}

/**
 * One resolved schematic by name (for golden tests / direct placement). Throws if absent.
 * @param {string} name
 * @returns {ResolvedSchematic}
 */
export function load_schematic(name) {
  const s = load_all_schematics().get(name)
  if (s === undefined) throw new Error(`schematic "${name}" not in bundle`)
  return s
}

/**
 * The resolved schematics of a bundle POOL (assets/schematics.json `pools[pool_id]`) — the set a
 * config-driven `structure_pool_overrides` maps a biome to (FIVE-WORLDS: swamp→pool_mangrove,
 * beach→pool_palms, config-only). Unknown pool ⇒ empty. Order follows the pool's member list (stable).
 * @param {string} pool_id
 * @returns {ResolvedSchematic[]}
 */
export function load_pool(pool_id) {
  const pools = /** @type {Record<string, string[]>} */ (/** @type {unknown} */ (bundle.pools) ?? {})
  const all = load_all_schematics()
  const out = []
  for (const name of pools[pool_id] ?? []) {
    const s = all.get(name)
    if (s !== undefined) out.push(s)
  }
  return out
}

/**
 * Every distinct legacy base block name across the whole bundle's palettes (for the mapping
 * coverage report — feed to registry_map.mapping_coverage).
 * @returns {string[]}
 */
export function bundle_block_names() {
  const set = new Set()
  const entries = /** @type {Record<string, RawSchematic>} */ (/** @type {unknown} */ (bundle.schematics))
  for (const raw of Object.values(entries)) for (const base of raw.palette) set.add(base)
  return [...set]
}
