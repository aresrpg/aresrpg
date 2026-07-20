// FIVE WORLDS registry (BIOMES_EXECUTION_PLAN Phase 0) — the named single-biome trailer worlds the
// `?biome=` switch selects. Each entry is a full, self-contained WorldGenConfig: a deep clone of the
// DEFAULT recipe + a `name` + a `biome_pin` PLACEHOLDER MARKER. Phase 0 ships the SELECTION MECHANISM
// end-to-end (create_engine → gen worker → gen modules read the config); the worlds deliberately look
// NEAR-IDENTICAL for now — the real per-biome recipes (splines/density/climate-pinning presets) land
// in the later biome lanes, which replace the placeholder marker with actual pinned climate fields +
// tuned splines. Because each blob carries distinct metadata, its `config_hash` already differs from
// DEFAULT and from every sibling (the world-identity peers agree on), so the plumbing is provable now.
//
// ONE world = ONE biome: `biome_pin` names the biome FAMILY each world will pin its climate to (a
// later lane makes temperature/humidity/etc. constant so only that family places). Today it is inert
// metadata — nothing in gen reads it yet — but it documents intent and differentiates the recipe.

import { DEFAULT_WORLD_GEN_CONFIG } from '../world_gen_config.js'

import { RAINFOREST_WORLD } from './rainforest.js'
import { EVEREST_WORLD } from './everest.js'
import { PARADISE_WORLD } from './paradise.js'
import { EVERGLADES_WORLD } from './everglades.js'
import { EMBER_STEPPE_WORLD } from './ember_steppe.js'
import { MISTRAL_HEIGHTS_WORLD } from './mistral_heights.js'
import { DROWNED_FEN_WORLD } from './drowned_fen.js'
import { PANDORA_REACH_WORLD } from './pandora_reach.js'
import { CHARNEL_MARCHES_WORLD } from './charnel_marches.js'
import { SILENT_ATOLL_WORLD } from './silent_atoll.js'
import { THE_SUNDERING_WORLD } from './the_sundering.js'
import { OBSIDIAN_CHOIR_WORLD } from './obsidian_choir.js'
import { ABYSSAL_WEALD_WORLD } from './abyssal_weald.js'
import { HOLLOW_CROWN_WORLD } from './hollow_crown.js'
import { ZENITH_SCAR_WORLD } from './zenith_scar.js'
import { CINDERFORGE_DEPTHS_WORLD } from './cinderforge_depths.js'
import { PALEWOOD_WORLD } from './palewood.js'
import { CORAL_THRONE_WORLD } from './coral_throne.js'
import { SUNSPIRE_DUNES_WORLD } from './sunspire_dunes.js'
import { ROOTHEART_WORLD } from './rootheart.js'
import { STATIC_FIELDS_WORLD } from './static_fields.js'
import { MIRRORMERE_WORLD } from './mirrormere.js'

/**
 * @typedef {import('../world_gen_config.js').WorldGenConfig & { name: string, biome_pin: string }} NamedWorldConfig
 */

/**
 * The five trailer worlds. Keys are the `?biome=` values. Each is a full WorldGenConfig — pass one
 * straight to `create_engine({ world_config })`. Biome pins per BIOMES_EXECUTION_PLAN Phase 3 + the
 * S-25 world-as-planet fan-out (every world a multi-biome planet):
 *   rainforest → tropical karst (Vietnam, world 02 verdant_hollow, +6-region layer) · ember_steppe →
 *   volcanic ash steppe (world 03 emberfall_steppe, +6-region layer; REPLACES the unbuilt `riviera`
 *   placeholder — the closest arid lean; declared in ember_steppe.js) · everest → ice-age massifs
 *   (5-region prototype) · everglades → swamp wetland · paradise → white-sand/turquoise beach (world 01
 *   first_shore, +6-region layer) · mistral_heights → windswept highland / mesa tiers (world 04
 *   mistral_heights, 6-region layer) · drowned_fen → black-water fen (world 05 drowned_fen, 6-region
 *   layer; the everglades trailer world stays the region-free no-drift control) · pandora_reach →
 *   alien jungle + cranked floating islands (world 06 pandora_reach, 6-region layer).
 * @type {Record<string, NamedWorldConfig>}
 */
export const WORLD_CONFIGS = {
  // All five are now real recipes (the last DEFAULT-clone placeholder, `riviera`, became ember_steppe for
  // world 03). Wired HERE, serially, by the lead — the one file all the per-world lanes would collide on.
  rainforest: RAINFOREST_WORLD,
  ember_steppe: EMBER_STEPPE_WORLD, // world 03 (was the unbuilt `riviera` DEFAULT-clone placeholder)
  everest: EVEREST_WORLD,
  everglades: EVERGLADES_WORLD,
  paradise: PARADISE_WORLD,
  mistral_heights: MISTRAL_HEIGHTS_WORLD, // world 04 (S-25 fan-out: windswept highlands)
  drowned_fen: DROWNED_FEN_WORLD, // world 05 (S-25 fan-out: black-water fen)
  pandora_reach: PANDORA_REACH_WORLD, // world 06 (S-25 fan-out: alien jungle + cranked sky islands)
  charnel_marches: CHARNEL_MARCHES_WORLD, // world 14 (S-25 fan-out: bone/ash war-graves marsh)
  silent_atoll: SILENT_ATOLL_WORLD, // world 15 (S-25 fan-out: becalmed glass-sea atoll rings)
  the_sundering: THE_SUNDERING_WORLD, // world 16 (S-25 fan-out: shattered rift waste + drifting shards)
  obsidian_choir: OBSIDIAN_CHOIR_WORLD, // world 17 (S-25 fan-out: ranked obsidian columns + pyre courses)
  abyssal_weald: ABYSSAL_WEALD_WORLD, // world 18 (S-25 fan-out: lightless weald + anglerlight hollows)
  hollow_crown: HOLLOW_CROWN_WORLD, // world 19 (S-25 fan-out: gold-white celestial ruin + halo shards)
  zenith_scar: ZENITH_SCAR_WORLD, // world 20 (S-25 fan-out: the flooded world-wound + fracture teeth)
  cinderforge_depths: CINDERFORGE_DEPTHS_WORLD, // world 07 (07-13 fan-out: forge craters + magma seas)
  palewood: PALEWOOD_WORLD, // world 08 (07-13 fan-out: bone-pale ghost forest)
  coral_throne: CORAL_THRONE_WORLD, // world 09 (07-13 fan-out: drowned turquoise reef shelf)
  sunspire_dunes: SUNSPIRE_DUNES_WORLD, // world 10 (07-13 fan-out: golden dune sea + true oases)
  rootheart: ROOTHEART_WORLD, // world 11 (07-13 fan-out: heartwood root-ridge forest)
  static_fields: STATIC_FIELDS_WORLD, // world 12 (07-13 fan-out: storm-plateau herd steppe)
  mirrormere: MIRRORMERE_WORLD, // world 13 (07-13 fan-out: frost mirror-lake country)
}

/** The selectable world names (for UI / validation). @type {string[]} */
export const WORLD_NAMES = Object.keys(WORLD_CONFIGS)

/**
 * Resolves a `?biome=` name to its world recipe. Unknown/empty names fall back to the DEFAULT world
 * with a console.warn (never throws — a bad URL param must not brick the boot). This is the SINGLE
 * home for the name→config resolution; the frontend embed calls it and passes the result to
 * create_engine (which validates it).
 * @param {string | null | undefined} name the `?biome=` value
 * @returns {import('../world_gen_config.js').WorldGenConfig} a full world recipe (DEFAULT on miss)
 */
export function world_config_for_biome(name) {
  if (!name) return DEFAULT_WORLD_GEN_CONFIG
  const world = WORLD_CONFIGS[name]
  if (world) return world
  console.warn(`[worlds] unknown biome "${name}" — expected one of ${WORLD_NAMES.join(', ')}; using the default world`)
  return DEFAULT_WORLD_GEN_CONFIG
}
