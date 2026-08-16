// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Cross-flora placement — the grass-OCEAN rule: the ONE cross-quad plant a land column grows (or bare).
// Extracted VERBATIM from surface_decorator.js (byte-identical placement stream) to give flora its own home
// and keep both files under the LoC law; decorate_chunk (surface_decorator.js) calls surface_flora per column.
// Shared densities + column hashing live in deco_shared.js (cycle break). Cross-flora blocks are feature-
// detected by name — a bundle missing a block silently skips it (a partial atlas still blooms with what baked).

import { get_block_by_name } from '../config/block_registry.js'

import { grass_covered } from './surface_density.js'
import { DECO_DEFAULTS, sprite_on, hash_column, in_grove } from './deco_shared.js'

const GRASS = get_block_by_name('grass')?.id
const DIRT = get_block_by_name('dirt')?.id
const SAND = get_block_by_name('sand')?.id
const TUFT = get_block_by_name('grass_tuft')?.id
// DIVERGENCE WAVE cross-flora (feature-detected — a bundle without these blocks just skips them).
const TALL_GRASS = get_block_by_name('tall_grass')?.id
const REED = get_block_by_name('reed')?.id
const FERN = get_block_by_name('fern')?.id
/** Every registered meadow-flower id (red/yellow/white/purple, whichever baked) — the picker splits across
 *  whatever resolved, so a partial bundle still blooms with its available kinds. */
const FLOWERS = /** @type {number[]} */ (
  ['flower_red', 'flower_yellow', 'flower_white', 'flower_purple']
    .map((name) => get_block_by_name(name)?.id)
    .filter((id) => id !== undefined)
)
/** Flowers place when AT LEAST one kind resolved; skipped silently when none are present. */
const FLOWERS_ENABLED = FLOWERS.length > 0

// VIVID-WORLD sprites (sprite-vivid lane, ids 40-61; feature-detected — absent ⇒ that kind no-ops). These
// are OPT-IN accents: a world enables one via decoration.sprites.<kind>:true, so the DEFAULT world (no map)
// never places them ⇒ byte-identical. `sprite_opt` gates them (explicit-true), NOT sprite_on (which is default-on).
const DUNE_GRASS = get_block_by_name('dune_grass')?.id
const SEASHELL = get_block_by_name('seashell')?.id
const STARFISH = get_block_by_name('starfish')?.id
const DRIFTWOOD = get_block_by_name('driftwood')?.id
const CATTAIL = get_block_by_name('cattail')?.id
const TOADSTOOL = get_block_by_name('toadstool')?.id // forest-floor only (opt-in)
/** biome → its accent kinds [block id, sprite key, DECO_DEFAULTS density key] (forest-floor toadstool gated separately). */
const BIOME_ACCENTS = /** @type {Record<string, [number|undefined, string, string][]>} */ ({
  tropical: [
    [get_block_by_name('jungle_plant')?.id, 'jungle_plant', 'jungle_plant_one_in'],
    [get_block_by_name('orchid')?.id, 'orchid', 'orchid_one_in'],
    [get_block_by_name('young_shoot')?.id, 'young_shoot', 'young_shoot_one_in'],
  ],
  swamp: [
    [get_block_by_name('swamp_weed')?.id, 'swamp_weed', 'swamp_weed_one_in'],
    [get_block_by_name('moss_tuft')?.id, 'moss_tuft', 'moss_tuft_one_in'],
  ],
  arctic: [
    [get_block_by_name('frozen_shrub')?.id, 'frozen_shrub', 'frozen_shrub_one_in'],
    [get_block_by_name('lichen')?.id, 'lichen', 'lichen_one_in'],
  ],
  glacier: [
    [get_block_by_name('frozen_shrub')?.id, 'frozen_shrub', 'frozen_shrub_one_in'],
    [get_block_by_name('lichen')?.id, 'lichen', 'lichen_one_in'],
  ],
  alpine: [
    [get_block_by_name('alpine_flower')?.id, 'alpine_flower', 'alpine_flower_one_in'],
    [get_block_by_name('lichen')?.id, 'lichen', 'lichen_one_in'],
    [get_block_by_name('frozen_shrub')?.id, 'frozen_shrub', 'frozen_shrub_one_in'],
  ],
  grassland: [
    [get_block_by_name('bush')?.id, 'bush', 'bush_one_in'],
    [get_block_by_name('dead_branch')?.id, 'dead_branch', 'dead_branch_one_in'],
    [get_block_by_name('pebbles')?.id, 'pebbles', 'pebbles_one_in'],
  ],
  mediterranean: [
    [get_block_by_name('thistle')?.id, 'thistle', 'thistle_one_in'],
    [get_block_by_name('lavender')?.id, 'lavender', 'lavender_one_in'],
    [get_block_by_name('garrigue')?.id, 'garrigue', 'garrigue_one_in'],
  ],
})

// Independent OPT-IN sprite salts (one per kind — decorrelated streams).
const SALT_DUNE = 0x2c1b3a9f
const SALT_SHELL = 0x7a5e11c3
const SALT_STAR = 0x51afd7e9
const SALT_DRIFT = 0x3f6b8d21
const SALT_CATTAIL = 0x6d2e4b17
const SALT_ACCENT = 0x9b4f27e5

/** OPT-IN sprite gate: a NEW vivid kind fires only when the world explicitly lists it true (absent ⇒ OFF ⇒
 *  byte-identical DEFAULT). Distinct from sprite_on, which defaults ON for the original land kinds.
 *  @param {any} deco @param {string} kind @returns {boolean} */
function sprite_opt(deco, kind) {
  return deco.sprites !== undefined && deco.sprites !== null && deco.sprites[kind] === true
}

/** Sparse per-biome accent on a grass column (one representative wins; else 0 → falls through to the carpet).
 *  @param {string} biome_name @param {number} world_x @param {number} world_z @param {number} seed
 *  @param {any} deco @returns {number} accent block id or 0 */
function pick_biome_accent(biome_name, world_x, world_z, seed, deco) {
  const kinds = BIOME_ACCENTS[biome_name]
  if (kinds === undefined) return 0
  for (let i = 0; i < kinds.length; i += 1) {
    const [id, key, density_key] = kinds[i]
    if (
      id !== undefined &&
      sprite_opt(deco, key) &&
      hash_column(world_x, world_z, (seed ^ (SALT_ACCENT + i)) >>> 0) % deco[density_key] === 0
    )
      return id
  }
  return 0
}

// Independent decision salts (decorrelated u32 streams — same hash, different salt; folded with the world
// seed at the call site). Only the FLORA salts live here; schematic salts stay in surface_decorator.js.
const SALT_FLOWER = 0x85ebca77
const SALT_TUFT = 0xc2b2ae3d
const SALT_FLOWER_KIND = 0x165667b1
const SALT_TALL = 0x27d4eb2f
const SALT_REED = 0x165667b5
const SALT_FERN = 0x1b873593
const SALT_PATH = 0xcc9e2d51
const SALT_FLOWER_PATCH = 0xe6546b64
const SALT_TALL_CLUSTER = 0x3b1e2f4d
const SALT_CARPET_MIX = 0xd6e8feb8 // meadow carpet species-mix roll (ref #2 herb variety)

/** Which cross-flora blocks resolved at load (for the world_gen boot log / decoration_availability report). */
export function flora_availability() {
  return {
    tuft: TUFT !== undefined,
    tall_grass: TALL_GRASS !== undefined,
    reed: REED !== undefined,
    fern: FERN !== undefined,
    meadow_flowers: FLOWERS.length,
    flowers_enabled: FLOWERS_ENABLED,
  }
}

/**
 * Picks a meadow-flower kind for a column that won the flower roll: an independent salted split across
 * EVERY registered flower id. MUST only be called under FLOWERS_ENABLED (FLOWERS non-empty).
 * @param {number} world_x @param {number} world_z @returns {number} flower block id
 */
function pick_flower(world_x, world_z) {
  return FLOWERS[hash_column(world_x, world_z, SALT_FLOWER_KIND) % FLOWERS.length]
}

/**
 * The ONE cross-flora block a land column grows (or 0 for bare) — the grass-OCEAN placement rule, a PURE
 * deterministic function of (surface block, biome, shore-ness, world_x, world_z, seed) with integer hashing
 * only (§3.7). Emits AT MOST ONE plant per column (a mutually-exclusive if/else) so the foliage quad budget
 * stays bounded at one slot/chunk (pool_renderer.js). Priority: shore reeds → forest-floor fern/tuft →
 * meadow flowers/tall_grass/tuft. Region-local; no neighbor reads.
 * @param {number} surface_block strata surface block id at the column
 * @param {import('../config/biome_registry.js').BiomeDef | undefined} biome dominant biome at the column
 * @param {boolean} is_shore column sits in the water-margin band (SEA_LEVEL < surface_y ≤ +SHORE_BAND)
 * @param {number} world_x @param {number} world_z @param {number} seed decorators sub-seed
 * @param {number} surface_y column surface world-y — drives the organic density field's altitude falloff
 * @param {typeof DECO_DEFAULTS} [deco] resolved decoration densities (config-driven; default = live values)
 * @returns {number} cross-flora block id, or 0 for a bare column
 */
export function surface_flora(surface_block, biome, is_shore, world_x, world_z, seed, surface_y, deco = DECO_DEFAULTS) {
  // 1. SHORE MARGIN (grass/dirt/sand water-margin, vegetated biomes) — CATTAIL wins a sparse share FIRST (so
  //    a dense reed config can't starve it), then classic REEDS fill the rest. Checked before the grass gate
  //    because river/lake margins are SAND; grass_density excludes desert/beach/arctic dune shores.
  const on_shore =
    is_shore &&
    biome !== undefined &&
    biome.grass_density >= deco.reed_min_grass &&
    (surface_block === GRASS || surface_block === DIRT || surface_block === SAND)
  if (
    on_shore &&
    CATTAIL !== undefined &&
    sprite_opt(deco, 'cattail') &&
    hash_column(world_x, world_z, (seed ^ SALT_CATTAIL) >>> 0) % deco.cattail_one_in === 0
  ) {
    return CATTAIL
  }
  if (
    on_shore &&
    REED !== undefined &&
    sprite_on(deco, 'reed') &&
    hash_column(world_x, world_z, (seed ^ SALT_REED) >>> 0) % deco.reed_one_in === 0
  ) {
    return REED
  }
  // 1c. BEACH SAND accents (dune grass, seashells, starfish, driftwood) — place on SAND, which the grass gate
  //     below rejects. All OPT-IN (absent ⇒ OFF ⇒ byte-identical DEFAULT). Densest → sparsest so grass wins.
  if (surface_block === SAND && biome !== undefined) {
    if (
      DUNE_GRASS !== undefined &&
      sprite_opt(deco, 'dune_grass') &&
      hash_column(world_x, world_z, (seed ^ SALT_DUNE) >>> 0) % deco.dune_grass_one_in === 0
    )
      return DUNE_GRASS
    if (
      SEASHELL !== undefined &&
      sprite_opt(deco, 'seashell') &&
      hash_column(world_x, world_z, (seed ^ SALT_SHELL) >>> 0) % deco.seashell_one_in === 0
    )
      return SEASHELL
    if (
      STARFISH !== undefined &&
      sprite_opt(deco, 'starfish') &&
      hash_column(world_x, world_z, (seed ^ SALT_STAR) >>> 0) % deco.starfish_one_in === 0
    )
      return STARFISH
    if (
      DRIFTWOOD !== undefined &&
      sprite_opt(deco, 'driftwood') &&
      hash_column(world_x, world_z, (seed ^ SALT_DRIFT) >>> 0) % deco.driftwood_one_in === 0
    )
      return DRIFTWOOD
  }
  // 1d. BIOME ACCENT on the biome's NATURAL surface — placed BEFORE the grass-only gate so it lands on
  //     Everest's SNOW/STONE (frost shrubs, lichen) as well as the rainforest grass floor (jungle plants),
  //     not just meadow grass. Biome-keyed + opt-in + sparse ⇒ off for DEFAULT, a scattered accent elsewhere.
  if (biome !== undefined && surface_block !== undefined) {
    const accent = pick_biome_accent(biome.name, world_x, world_z, seed, deco)
    if (accent !== 0) return accent
  }
  // The rest of the ocean is grass-surfaced only.
  if (surface_block !== GRASS || biome === undefined) return 0

  // 2. FOREST FLOOR — a dense LOW fern carpet (walkable — fern is sub-block), barer along grove PATHS so
  //    trunks + lanes stay readable. Darker broad-leaf art + the canopy's low sun byte read as shade flora.
  if (biome.tree_density >= deco.forest_tree_density) {
    if (in_grove(world_x, world_z, (seed ^ SALT_PATH) >>> 0, deco.path_one_in, deco.grove_cell_shift)) return 0 // a bare walking lane
    if (
      TOADSTOOL !== undefined &&
      sprite_opt(deco, 'toadstool') &&
      hash_column(world_x, world_z, (seed ^ (SALT_ACCENT ^ 0x9e37)) >>> 0) % deco.toadstool_one_in === 0
    )
      return TOADSTOOL // forest-floor mushrooms (opt-in)
    if (
      FERN !== undefined &&
      sprite_on(deco, 'fern') &&
      hash_column(world_x, world_z, (seed ^ SALT_FERN) >>> 0) % deco.fern_one_in === 0
    )
      return FERN
    if (
      TUFT !== undefined &&
      sprite_on(deco, 'tuft') &&
      hash_column(world_x, world_z, (seed ^ SALT_TUFT) >>> 0) % deco.forest_tuft_one_in === 0
    )
      return TUFT
    return 0
  }

  // 3. OPEN MEADOW (size rule) — a dense LOW short-grass carpet is the BULK (many-small ⇒ FULL
  //    read), with SCATTERED TALL-grass clusters as the minority silhouette accent, plus flower patches.
  // [2026-07-05 owner] ORGANIC DENSITY FIELD for the WHOLE herb layer — grass_covered (surface_density.js):
  //    a continuous humidity+altitude coverage probability vs a per-column hash, NOT the old chunk-sized
  //    macro cell (which blanked whole chunks). Humid hollows full, dry rises thin, high ground sparse; no
  //    cell size ⇒ no chunk-aligned holes. Placed ABOVE 3a/3b deliberately: thinning punches through tall
  //    stands and flower patches too — gating only the 3c carpet culled the carpet while cluster talls
  //    bypassed it, flipping the intended grass-dominant mix (caught by the meadow-mix test).
  if (!grass_covered(world_x, world_z, surface_y, seed)) return 0
  // 3a. tall accent cluster — coherent grove patches (~1/5 of cells) that read as tall stands, not stray sticks.
  if (
    TALL_GRASS !== undefined &&
    sprite_on(deco, 'tall_grass') &&
    in_grove(world_x, world_z, (seed ^ SALT_TALL_CLUSTER) >>> 0, deco.tall_cluster_one_in, deco.grove_cell_shift) &&
    hash_column(world_x, world_z, (seed ^ SALT_TALL) >>> 0) % deco.tall_in_cluster_one_in === 0
  ) {
    return TALL_GRASS
  }
  // 3b. flower patch (meadow colour accents).
  if (
    FLOWERS_ENABLED &&
    sprite_on(deco, 'flower') &&
    in_grove(world_x, world_z, (seed ^ SALT_FLOWER_PATCH) >>> 0, deco.flower_patch_one_in, deco.grove_cell_shift) &&
    hash_column(world_x, world_z, (seed ^ SALT_FLOWER) >>> 0) % deco.flower_in_patch_one_in === 0
  ) {
    return pick_flower(world_x, world_z)
  }
  // 3c. the dense carpet — a SPECIES-MIXED herb layer (ref #2: "5-8 visibly different plants…
  //     grass dominant, weeds/flowers as seasoning"). Every remaining meadow column grows ONE plant,
  //     hash-picked from a weighted herb palette so neighbours read as different species.
  if (TUFT === undefined) return 0
  const roll = hash_column(world_x, world_z, (seed ^ SALT_CARPET_MIX) >>> 0) % 100
  // Sprite-selection aware: a disabled KIND falls through to the next, ultimately to the short tuft carpet
  // (or bare if even tuft is off). Default (all on) is byte-identical to the original tuft/tall/flower/fern mix.
  const tuft_pick = TUFT !== undefined && sprite_on(deco, 'tuft') ? TUFT : 0
  if (roll < 72) return tuft_pick // grass dominant (~60-70%); the short carpet is the bulk
  if (roll < 80 && TALL_GRASS !== undefined && sprite_on(deco, 'tall_grass')) return TALL_GRASS // sprinkled tall blades
  if (roll < 92 && FLOWERS_ENABLED && sprite_on(deco, 'flower')) return pick_flower(world_x, world_z) // wild blooms
  if (FERN !== undefined && sprite_on(deco, 'fern')) return FERN // broad-leaf meadow weed (fern art)
  return tuft_pick
}
