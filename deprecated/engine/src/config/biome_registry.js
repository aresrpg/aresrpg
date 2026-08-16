// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Biome registry (§4.3) — FROZEN SCHEMA. WS2 (gen/biome_placer, column_gen) writes `biome`
// ids into ChunkRecords against this table; WS4/WS6 (materials, foliage) read surface/spawn
// rules; WS9 (structures) reads structure pools. Adding biomes later is additive-only — the
// numeric `id` is persisted in chunk `biome` arrays (§3.4) and MUST never be reused/renumbered
// without a version bump + golden-hash re-cut (§3.7).
//
// The 6-parameter placement space (§4.1) generalizes the legacy 3×3 heat/rain BiomesMapping:
// each biome declares a target point in normalized [0,1] climate space + tolerances; the placer
// (biome_placer.js) does nearest-fit with smoothstep transition weights. `weirdness_gate` marks
// the esoteric biomes reachable only at extreme weirdness (§4.3) — zero special-case code, just
// a rare gate. Height shaping (base/amplitude/relief) is driven by continentalness/erosion/PV
// via terrain_shaper.js; per-biome `land` strata pick surface/subsurface/underwater blocks.

import { get_block_by_name } from './block_registry.js'

/** @typedef {import('./block_registry.js').BlockDef} BlockDef */

/**
 * Normalized [0,1] target point in the 6-parameter climate/shape space (§4.1). Only the axes a
 * biome actually cares about need be meaningful; unconstrained axes use tolerance 1 (don't-care).
 * @typedef {object} ClimatePoint
 * @property {number} temperature 0 cold → 1 hot
 * @property {number} humidity 0 dry → 1 wet
 * @property {number} continentalness 0 deep-ocean → 1 far-inland
 * @property {number} erosion 0 mountainous → 1 flat
 * @property {number} pv 0 valley/river → 1 peak (peaks-and-valleys, derived from weirdness)
 */

/**
 * Per-elevation-band block strata (§4.2 "per-biome land tables"). Surface = top block, subsurface
 * = the few blocks under it, underwater = surface substitute below sea level, filler = deep stone.
 * @typedef {object} BiomeLand
 * @property {string} surface top-of-column block name
 * @property {string} subsurface block name for the SUBSURFACE_DEPTH band under the surface
 * @property {string} underwater surface substitute when the column top is below sea level
 * @property {string} filler deep block name (everything below subsurface)
 */

/**
 * @typedef {object} BiomeDef
 * @property {number} id stable numeric id — persisted in chunk `biome` arrays, never reused
 * @property {string} name snake_case identifier
 * @property {ClimatePoint} climate target point in the 6-param placement space (§4.1/§4.3)
 * @property {number} weight nearest-fit tie-break priority; higher wins near-equal distances
 * @property {boolean} weirdness_gate true = esoteric, only placed at |weirdness| near the extreme
 * @property {BiomeLand} land surface/subsurface/underwater/filler block strata (§4.2)
 * @property {number} tree_density 0..1 gen decorator hint (trees per surface column probability)
 * @property {number} grass_density 0..1 gen clutter-map hint (§6.3 foliage)
 * @property {string[]} structure_pools jigsaw/schematic pool ids eligible in this biome (§4.6).
 *   Schematic pool ids (pool_*) are defined by the converted bundle (assets/schematics.json `pools`,
 *   FIVE-WORLDS P2); jigsaw ids (village_plains, crystal_geode, …) are future structure sets.
 * @property {string} music_bed audio biome-bed id (§6.4)
 */

/**
 * Number of subsurface blocks under the surface block before deep filler takes over (§4.2 strata).
 * Kept here (not per-biome) — a single-source shaping constant shared by column_gen.
 */
export const SUBSURFACE_DEPTH = 4

/**
 * Weirdness magnitude threshold above which esoteric (weirdness-gated) biomes become eligible.
 * Weirdness is normalized [0,1] with 0.5 = neutral; |w-0.5|*2 >= this ⇒ extreme (§4.3).
 */
export const WEIRDNESS_ESOTERIC_THRESHOLD = 0.82

/** @type {BiomeDef[]} */
export const BIOME_REGISTRY = [
  {
    id: 0,
    name: 'ocean',
    climate: { temperature: 0.5, humidity: 0.6, continentalness: 0.05, erosion: 0.8, pv: 0.3 },
    weight: 1.4,
    weirdness_gate: false,
    land: { surface: 'sand', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
    tree_density: 0,
    grass_density: 0,
    structure_pools: [],
    music_bed: 'ocean',
  },
  {
    id: 1,
    name: 'beach',
    climate: { temperature: 0.55, humidity: 0.5, continentalness: 0.32, erosion: 0.85, pv: 0.45 },
    weight: 1.1,
    weirdness_gate: false,
    land: { surface: 'sand', subsurface: 'sand', underwater: 'sand', filler: 'stone' },
    tree_density: 0.01,
    grass_density: 0.05,
    // Paradise-beach reef rocks + driftwood boulders. GAP: no palm schematics exist in the legacy
    // packs (declared P2) — palms await an art source; tropical canopy is the nearest stand-in.
    structure_pools: ['pool_coral', 'pool_rocks_tropical'],
    music_bed: 'beach',
  },
  {
    id: 2,
    name: 'river',
    climate: { temperature: 0.5, humidity: 0.7, continentalness: 0.55, erosion: 0.7, pv: 0.02 },
    weight: 1.2,
    weirdness_gate: false,
    land: { surface: 'sand', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
    tree_density: 0.05,
    grass_density: 0.3,
    structure_pools: ['pool_broadleaf', 'pool_rocks_granite'],
    music_bed: 'river',
  },
  {
    id: 3,
    name: 'grassland',
    climate: { temperature: 0.55, humidity: 0.3, continentalness: 0.7, erosion: 0.8, pv: 0.5 },
    weight: 1,
    weirdness_gate: false,
    land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
    tree_density: 0.03,
    grass_density: 0.7,
    structure_pools: ['village_plains', 'pool_broadleaf', 'pool_savanna_trees', 'pool_rocks_granite'],
    music_bed: 'grassland',
  },
  {
    id: 4,
    name: 'temperate_forest',
    climate: { temperature: 0.5, humidity: 0.55, continentalness: 0.68, erosion: 0.72, pv: 0.5 },
    weight: 1,
    weirdness_gate: false,
    land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
    tree_density: 0.18,
    grass_density: 0.5,
    structure_pools: ['village_plains', 'pool_broadleaf', 'pool_birch', 'pool_giant_mushrooms', 'pool_rocks_granite'],
    music_bed: 'forest',
  },
  {
    id: 5,
    name: 'dense_forest',
    climate: { temperature: 0.48, humidity: 0.75, continentalness: 0.66, erosion: 0.68, pv: 0.52 },
    weight: 1,
    weirdness_gate: false,
    land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
    tree_density: 0.35,
    grass_density: 0.6,
    structure_pools: ['pool_broadleaf', 'pool_birch', 'pool_conifers', 'pool_giant_mushrooms', 'pool_rocks_granite'],
    music_bed: 'forest',
  },
  {
    id: 6,
    name: 'swamp',
    climate: { temperature: 0.6, humidity: 0.9, continentalness: 0.58, erosion: 0.9, pv: 0.32 },
    weight: 1,
    weirdness_gate: false,
    land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
    tree_density: 0.12,
    grass_density: 0.4,
    structure_pools: ['pool_swamp_trees', 'pool_swamp_undergrowth', 'pool_dead_trees', 'pool_mud_mounds'],
    music_bed: 'swamp',
  },
  {
    id: 7,
    name: 'taiga',
    climate: { temperature: 0.28, humidity: 0.4, continentalness: 0.7, erosion: 0.6, pv: 0.55 },
    weight: 1,
    weirdness_gate: false,
    land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
    tree_density: 0.2,
    grass_density: 0.35,
    structure_pools: ['pool_conifers', 'pool_broadleaf', 'pool_rocks_granite'],
    music_bed: 'taiga',
  },
  {
    id: 8,
    name: 'arctic',
    climate: { temperature: 0.1, humidity: 0.6, continentalness: 0.68, erosion: 0.7, pv: 0.5 },
    weight: 1,
    weirdness_gate: false,
    land: { surface: 'snow', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
    tree_density: 0.04,
    grass_density: 0.1,
    structure_pools: ['pool_dead_trees', 'pool_conifers', 'pool_ice', 'pool_rocks_alpine'],
    music_bed: 'arctic',
  },
  {
    id: 9,
    name: 'glacier',
    climate: { temperature: 0.05, humidity: 0.85, continentalness: 0.6, erosion: 0.5, pv: 0.6 },
    weight: 1,
    weirdness_gate: false,
    land: { surface: 'snow', subsurface: 'snow', underwater: 'stone', filler: 'stone' },
    tree_density: 0,
    grass_density: 0,
    structure_pools: ['pool_ice', 'pool_rocks_alpine', 'pool_structures'],
    music_bed: 'arctic',
  },
  {
    id: 10,
    name: 'desert',
    climate: { temperature: 0.92, humidity: 0.08, continentalness: 0.72, erosion: 0.82, pv: 0.5 },
    weight: 1,
    weirdness_gate: false,
    land: { surface: 'sand', subsurface: 'sand', underwater: 'sand', filler: 'stone' },
    tree_density: 0.005,
    grass_density: 0.05,
    structure_pools: ['pool_desert_flora', 'pool_dead_trees', 'pool_rocks_sandstone', 'pool_structures'],
    music_bed: 'desert',
  },
  {
    id: 11,
    name: 'scorched_badlands',
    climate: { temperature: 0.95, humidity: 0.2, continentalness: 0.7, erosion: 0.4, pv: 0.62 },
    weight: 1,
    weirdness_gate: false,
    land: { surface: 'sand', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
    tree_density: 0,
    grass_density: 0.02,
    structure_pools: ['pool_dead_trees', 'pool_rocks_volcanic', 'pool_rocks_sandstone'],
    music_bed: 'desert',
  },
  {
    id: 12,
    name: 'tropical',
    climate: { temperature: 0.85, humidity: 0.85, continentalness: 0.65, erosion: 0.75, pv: 0.48 },
    weight: 1,
    weirdness_gate: false,
    land: { surface: 'grass', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
    tree_density: 0.28,
    grass_density: 0.7,
    structure_pools: ['pool_jungle_giants', 'pool_tropical_undergrowth', 'pool_rocks_tropical'],
    music_bed: 'tropical',
  },
  {
    id: 13,
    name: 'alpine',
    climate: { temperature: 0.3, humidity: 0.45, continentalness: 0.72, erosion: 0.15, pv: 0.85 },
    weight: 1.05,
    weirdness_gate: false,
    land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
    tree_density: 0.05,
    grass_density: 0.2,
    structure_pools: ['pool_conifers', 'pool_rocks_alpine', 'pool_rocks_granite'],
    music_bed: 'alpine',
  },
  // ---- Esoteric biomes (weirdness-gated, §4.3) --------------------------------------------
  {
    id: 14,
    name: 'crystal_hollows',
    climate: { temperature: 0.5, humidity: 0.5, continentalness: 0.75, erosion: 0.5, pv: 0.6 },
    weight: 1,
    weirdness_gate: true,
    land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
    tree_density: 0.02,
    grass_density: 0.15,
    structure_pools: ['crystal_geode', 'pool_giant_mushrooms'],
    music_bed: 'esoteric',
  },
  {
    id: 15,
    name: 'obsidian_spires',
    climate: { temperature: 0.7, humidity: 0.2, continentalness: 0.74, erosion: 0.1, pv: 0.92 },
    weight: 1,
    weirdness_gate: true,
    land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
    tree_density: 0,
    grass_density: 0,
    structure_pools: ['obsidian_spire', 'pool_rocks_volcanic'],
    music_bed: 'esoteric',
  },
  {
    id: 16,
    name: 'void_marsh',
    climate: { temperature: 0.4, humidity: 0.95, continentalness: 0.55, erosion: 0.95, pv: 0.25 },
    weight: 1,
    weirdness_gate: true,
    land: { surface: 'dirt', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
    tree_density: 0.03,
    grass_density: 0.1,
    structure_pools: ['pool_swamp_undergrowth', 'pool_dead_trees', 'pool_mud_mounds'],
    music_bed: 'esoteric',
  },
]

/** Lookup: biome id → BiomeDef. Built once at module load. */
const BY_ID = new Map(BIOME_REGISTRY.map((def) => [def.id, def]))
/** Lookup: biome name → BiomeDef. Built once at module load. */
const BY_NAME = new Map(BIOME_REGISTRY.map((def) => [def.name, def]))

/** Non-esoteric biomes (the always-eligible placement set). */
export const COMMON_BIOMES = BIOME_REGISTRY.filter((b) => !b.weirdness_gate)
/** Esoteric biomes (eligible only at extreme weirdness). */
export const ESOTERIC_BIOMES = BIOME_REGISTRY.filter((b) => b.weirdness_gate)

/**
 * Looks up a biome definition by numeric id.
 * @param {number} id
 * @returns {BiomeDef | undefined}
 */
export function get_biome_by_id(id) {
  return BY_ID.get(id)
}

/**
 * Looks up a biome definition by snake_case name.
 * @param {string} name
 * @returns {BiomeDef | undefined}
 */
export function get_biome_by_name(name) {
  return BY_NAME.get(name)
}

/**
 * Resolves a biome's four strata block *ids* once (name → id via block_registry). Callers that
 * fill columns want ids, not names, per voxel — this keeps the hot loop off Map lookups.
 * @param {BiomeDef} biome
 * @returns {{ surface: number, subsurface: number, underwater: number, filler: number }}
 */
export function resolve_land_block_ids(biome) {
  const id_of = (/** @type {string} */ name) => /** @type {number} */ (get_block_by_name(name)?.id ?? 0)
  return {
    surface: id_of(biome.land.surface),
    subsurface: id_of(biome.land.subsurface),
    underwater: id_of(biome.land.underwater),
    filler: id_of(biome.land.filler),
  }
}
