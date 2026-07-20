// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Schematic block mapping (§4.6 vegetation/schematics wave, phase A) — legacy Minecraft block base
// names (from the Sponge `.schem` packs, blockstate properties already stripped by the converter)
// → this engine's block_registry ids. block_registry.js is read READ-ONLY; targets are resolved by
// NAME at module load, so registry id shifts follow automatically and we NEVER invent registry
// entries. Unmappable blocks resolve to a documented FALLBACK (stone) and are flagged for the
// coverage report — no silent holes, no fabricated blocks.
//
// The mapping is a small ORDERED keyword ruleset rather than a per-name table: it covers the whole
// legacy pack (dozens of wood/leaf/stone variants) with a handful of rules, so phase B can add any
// schematic and it still maps. `tier` records fidelity: 'faithful' = a true semantic match,
// 'lossy' = an intentional-but-approximate stand-in (ice→snow, colored terracotta→stone; this
// registry has no ice or colored decorative blocks), 'unmapped' = nothing matched → hard fallback.

import { get_block_by_name } from '../../config/block_registry.js'

/** @typedef {'faithful'|'lossy'|'unmapped'} MappingTier */

/**
 * @typedef {object} BlockMapping
 * @property {number} block_id resolved block_registry id
 * @property {string} block_name resolved registry block name
 * @property {MappingTier} tier fidelity of the mapping (see file header)
 */

/**
 * Resolves a registry block name → id at load, throwing if a target is missing (targets are core
 * blocks that must exist; a miss is a real registry regression, not a runtime condition).
 * @param {string} name
 * @returns {number}
 */
function require_block_id(name) {
  const def = get_block_by_name(name)
  if (def === undefined) throw new Error(`registry_map target block "${name}" missing from registry`)
  return def.id
}

// Resolve the (small) set of target blocks once. If block_registry grows dedicated ice/mushroom
// blocks later, only these names change — the ruleset stays put.
const ID_AIR = require_block_id('air')
const ID_STONE = require_block_id('stone')
const ID_DIRT = require_block_id('dirt')
const ID_GRASS = require_block_id('grass')
const ID_SAND = require_block_id('sand')
const ID_LOG = require_block_id('log')
const ID_LEAVES = require_block_id('leaves')
// D164 species-aware leaf variants (block_registry ids 28/29) — resolved by NAME like every other
// target, so registry id shifts follow automatically. Conifer = spruce/pine (dark needled); dry =
// acacia/savanna (straw). Broadleaf `leaves` (id 7) stays the default for oak/birch/azalea/jungle/dark_oak.
const ID_LEAVES_CONIFER = require_block_id('leaves_conifer')
const ID_LEAVES_DRY = require_block_id('leaves_dry')
const ID_SNOW = require_block_id('snow')
// FIVE-WORLDS: real ice blocks now exist (ids 30/31) — the ice family maps FAITHFULLY, retiring P2's
// lossy ice→snow stand-in (packed_ice/blue_ice → the denser packed_ice; plain/frosted ice → ice).
const ID_ICE = require_block_id('ice')
const ID_PACKED_ICE = require_block_id('packed_ice')
// FIVE-WORLDS palm blocks (ids 32/33) — the hand-composed Paradise palm schematics use explicit
// `palm_log`/`palm_leaves` palette names that map FAITHFULLY here (compound rules precede log/leaves).
const ID_PALM_LOG = require_block_id('palm_log')
const ID_PALM_LEAVES = require_block_id('palm_leaves')
// FIVE-WORLDS Paradise CORAL REEF: pool_coral schematics are authored in vivid wools (magenta/purple/red/
// cyan/yellow/lime). Remap to the MATTE reef-stone CUBE blocks so the submerged reef reads as textured
// coral, not grey stone (wool→stone) nor the rejected emissive translucent caps. Rose←warm, cyan←cool, gold←yellow.
const ID_CORAL_ROSE = require_block_id('coral_rock_rose')
const ID_CORAL_CYAN = require_block_id('coral_rock_cyan')
const ID_CORAL_GOLD = require_block_id('coral_rock_gold')

/**
 * Ordered keyword rules. First match wins, so ORDER MATTERS — e.g. `sandstone` must hit `sand`
 * before `stone`, and green decorative blocks must hit before the generic terracotta→stone rule.
 * Each rule tags its fidelity; `substr` matches anywhere in the base name.
 * @type {{ substr: string, name: string, id: number, tier: MappingTier }[]}
 */
const RULES = [
  // D164 SPECIES-AWARE LEAVES — MUST precede the generic `leaves` rule (first match wins). Each species
  // rule uses the COMPOUND `<species>_leaves` substring so a `spruce_log` / `acacia_wood` still falls
  // through to the log rule (bare `spruce`/`acacia` would wrongly steal bark). MAPPING TABLE (honest,
  // from the shipped bundle's real palette names — see loader.bundle_block_names / D164_PLAN):
  //   spruce_leaves → conifer (TAIGA_HUGE_SAPIN — dark needled evergreen)
  //   acacia_leaves → dry     (GRASSLAND_ACACIA — savanna straw canopy)
  //   dark_oak/azalea/birch/jungle_leaves → broadleaf `leaves` (lush; the generic rule below catches them)
  // Set-level fallback for GENERIC 'leaves' entries in arid/taiga sets lives in loader.js (resolve_schematic),
  // where the schematic SET name is known; this table is the per-PALETTE-NAME layer.
  { substr: 'spruce_leaves', name: 'leaves_conifer', id: ID_LEAVES_CONIFER, tier: 'faithful' },
  { substr: 'pine_leaves', name: 'leaves_conifer', id: ID_LEAVES_CONIFER, tier: 'faithful' },
  { substr: 'acacia_leaves', name: 'leaves_dry', id: ID_LEAVES_DRY, tier: 'faithful' },
  // FIVE-WORLDS palm — MUST precede the generic `leaves`/`log` rules (compound substr, first match wins).
  { substr: 'palm_leaves', name: 'palm_leaves', id: ID_PALM_LEAVES, tier: 'faithful' },
  { substr: 'palm_log', name: 'palm_log', id: ID_PALM_LOG, tier: 'faithful' },
  { substr: 'leaves', name: 'leaves', id: ID_LEAVES, tier: 'faithful' },
  // logs/wood: matches oak_log, spruce_wood, stripped_birch_wood, mangrove_wood, ...
  { substr: 'log', name: 'log', id: ID_LOG, tier: 'faithful' },
  { substr: 'wood', name: 'log', id: ID_LOG, tier: 'faithful' },
  // sand family before generic stone (sandstone contains both "sand" and "stone").
  { substr: 'sand', name: 'sand', id: ID_SAND, tier: 'faithful' },
  // green/lime decorative → leaves (foliage color) before the generic terracotta/concrete→stone.
  { substr: 'green_terracotta', name: 'leaves', id: ID_LEAVES, tier: 'lossy' },
  { substr: 'green_concrete', name: 'leaves', id: ID_LEAVES, tier: 'lossy' },
  { substr: 'lime_terracotta', name: 'leaves', id: ID_LEAVES, tier: 'lossy' },
  { substr: 'lime_concrete', name: 'leaves', id: ID_LEAVES, tier: 'lossy' },
  // ice family → real ice (FIVE-WORLDS ids 30/31). packed_ice/blue_ice → the denser packed_ice; plain/
  // frosted ice → ice. MUST precede `snow` (both faithful now). Compound `packed`/`blue` substrings first.
  { substr: 'packed_ice', name: 'packed_ice', id: ID_PACKED_ICE, tier: 'faithful' },
  { substr: 'blue_ice', name: 'packed_ice', id: ID_PACKED_ICE, tier: 'faithful' },
  { substr: 'ice', name: 'ice', id: ID_ICE, tier: 'faithful' },
  { substr: 'snow', name: 'snow', id: ID_SNOW, tier: 'faithful' },
  { substr: 'grass', name: 'grass', id: ID_GRASS, tier: 'faithful' },
  { substr: 'dirt', name: 'dirt', id: ID_DIRT, tier: 'faithful' },
  { substr: 'podzol', name: 'dirt', id: ID_DIRT, tier: 'faithful' },
  { substr: 'mud', name: 'dirt', id: ID_DIRT, tier: 'faithful' },
  // colored decorative solids → stone (no colored blocks in the registry) — lossy stand-ins.
  { substr: 'terracotta', name: 'stone', id: ID_STONE, tier: 'lossy' },
  { substr: 'concrete', name: 'stone', id: ID_STONE, tier: 'lossy' },
  // CORAL reef wools → matte reef-stone cubes (before the generic wool→stone). Only pool_coral uses these.
  { substr: 'magenta_wool', name: 'coral_rock_rose', id: ID_CORAL_ROSE, tier: 'lossy' },
  { substr: 'purple_wool', name: 'coral_rock_rose', id: ID_CORAL_ROSE, tier: 'lossy' },
  { substr: 'red_wool', name: 'coral_rock_rose', id: ID_CORAL_ROSE, tier: 'lossy' },
  { substr: 'cyan_wool', name: 'coral_rock_cyan', id: ID_CORAL_CYAN, tier: 'lossy' },
  { substr: 'lime_wool', name: 'coral_rock_cyan', id: ID_CORAL_CYAN, tier: 'lossy' },
  { substr: 'yellow_wool', name: 'coral_rock_gold', id: ID_CORAL_GOLD, tier: 'lossy' },
  { substr: 'wool', name: 'stone', id: ID_STONE, tier: 'lossy' },
  // faithful stone-likes.
  { substr: 'stone', name: 'stone', id: ID_STONE, tier: 'faithful' },
  { substr: 'cobble', name: 'stone', id: ID_STONE, tier: 'faithful' },
  { substr: 'andesite', name: 'stone', id: ID_STONE, tier: 'faithful' },
  { substr: 'diorite', name: 'stone', id: ID_STONE, tier: 'faithful' },
  { substr: 'granite', name: 'stone', id: ID_STONE, tier: 'faithful' },
  { substr: 'basalt', name: 'stone', id: ID_STONE, tier: 'faithful' },
  { substr: 'blackstone', name: 'stone', id: ID_STONE, tier: 'faithful' },
  { substr: 'deepslate', name: 'stone', id: ID_STONE, tier: 'faithful' },
  { substr: 'tuff', name: 'stone', id: ID_STONE, tier: 'faithful' },
  { substr: 'gravel', name: 'stone', id: ID_STONE, tier: 'faithful' },
]

/** Documented hard fallback for anything no rule matches. */
export const FALLBACK_BLOCK_ID = ID_STONE

/**
 * Maps a legacy block BASE name (no `minecraft:` prefix, no `[..]` blockstate) → a registry block.
 * Air variants resolve to the air block. Never throws; unmatched names return the documented
 * FALLBACK with tier 'unmapped' so callers can report the gap.
 * @param {string} base_name e.g. "oak_wood", "azalea_leaves", "packed_ice"
 * @returns {BlockMapping}
 */
export function map_block_name(base_name) {
  if (base_name === 'air' || base_name === 'cave_air' || base_name === 'void_air')
    return { block_id: ID_AIR, block_name: 'air', tier: 'faithful' }
  for (const rule of RULES) {
    if (base_name.includes(rule.substr)) return { block_id: rule.id, block_name: rule.name, tier: rule.tier }
  }
  return { block_id: FALLBACK_BLOCK_ID, block_name: 'stone', tier: 'unmapped' }
}

/**
 * @typedef {object} MappingCoverage
 * @property {number} total distinct base names examined
 * @property {number} faithful count mapped with a true semantic match
 * @property {number} lossy count mapped with an intentional approximate stand-in
 * @property {number} unmapped count that hit the hard fallback
 * @property {number} coverage fraction resolved to a real (non-fallback) block, 0..1
 * @property {{ name: string, tier: MappingTier, block_name: string }[]} entries per-name detail
 */

/**
 * Coverage report over a set of distinct base names (e.g. every name in the shipped bundle's
 * palettes). `coverage` counts faithful+lossy as resolved; only 'unmapped' (hard fallback) is a gap.
 * @param {Iterable<string>} base_names
 * @returns {MappingCoverage}
 */
export function mapping_coverage(base_names) {
  const entries = []
  let faithful = 0
  let lossy = 0
  let unmapped = 0
  for (const name of base_names) {
    const m = map_block_name(name)
    if (m.tier === 'faithful') faithful += 1
    else if (m.tier === 'lossy') lossy += 1
    else unmapped += 1
    entries.push({ name, tier: m.tier, block_name: m.block_name })
  }
  const total = entries.length
  return {
    total,
    faithful,
    lossy,
    unmapped,
    coverage: total === 0 ? 1 : (faithful + lossy) / total,
    entries,
  }
}
