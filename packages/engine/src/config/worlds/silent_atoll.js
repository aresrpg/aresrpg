// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD 15 · SILENT ATOLL (on-chain `15_silent_atoll`, biome `dead_calm_sea`) — the becalmed-sea
// planet. Seed identity (seed/mainnet/15_silent_atoll/world.json): water+earth elements, "the becalm —
// no wind, no tide; sound carries forever across the flat sea", barren of gather nodes, wisdom lean.
// The engine identity: a vast DEAD-CALM pale sea — glassy desaturated water with unnaturally long
// sight-lines, low bleached sand cays and atoll rings barely above the waterline, hushed pale groves,
// washed-out dune backs. paradise (world 01) is the direct prior art: the archipelago continentalness
// lever + the shallow-shelf coast profile, re-tuned HUSHED — bleached near-grey palette, glass water,
// sparser life — where paradise is a vivid postcard.
//
// ─── ARCHITECTURE (the S-25 fan-out pattern) ────────────────────────────────────────────────────────────
// A CLASSIC-SPLINE world (massif OFF): the region layer's terrain knobs WERE inert pre-2026-07-13 — now LIVE on the spline path (S-25+ region-driven terrain, column_gen.raw_land_no_cirque; see TERRAIN KNOBS on the classes) (the classes below carry them). The region layer PINS the BIOME per column; the atoll TERRAIN
// (shelf/cay/ring mosaic) comes from the shortened continentalness period + the flat coast profile.
//
// DECORATION-KEY LAW (surface_decorator.js:491): `structure_pool_overrides` + `tree_species` keys are
// REGISTRY names (the paradise idiom); evocative names ride the region CLASSES. pool_coral is the LIVE
// water-anchor reef pool (paradise-proven): it roots only where water is actually present, so the reef
// lands on the submerged shelf, never dry sand.

import { DEFAULT_WORLD_GEN_CONFIG } from '../world_gen_config.js'

/** @typedef {import('../world_gen_config.js').WorldGenConfig & { name: string, biome_pin: string }} NamedWorldConfig */

/**
 * Builds the silent-atoll recipe: a deep clone of the live DEFAULT (inherits every field this lane
 * does not tune, so it tracks the schema) + the becalmed-sea overrides + the world identity metadata.
 * @returns {NamedWorldConfig}
 */
function build_silent_atoll() {
  const base = /** @type {NamedWorldConfig} */ (structuredClone(DEFAULT_WORLD_GEN_CONFIG))

  base.name = 'silent_atoll'
  base.biome_pin = 'dead_calm_sea'
  base.seed = 'silent-atoll-becalm' // probed for the region-field percentiles below (probe_rdist method)
  base.version = 1 // silent-atoll recipe lineage v1 (config_hash differs from DEFAULT + every sibling)

  // --- CLIMATE FIELD FREQUENCIES (noise) ---------------------------------------------------------
  // The paradise archipelago lever: a short continentalness period breaks the coast into cay/atoll
  // rings with becalmed flats between them — "mostly sea". The rest stay DEFAULT.
  base.noise = {
    ...base.noise,
    continentalness: { period: 1800, octaves: 6, spread: 2, gain: 0.5 }, // (was 4096) atoll-ring coast
  }

  // --- TERRAIN SHAPING SPLINES (the flat becalmed shelf) ------------------------------------------
  base.splines = {
    // MOSTLY SEA: a broad shallow shelf under the waterline (the glass flats), thin dry cays snapping
    // to the beach-flatten band, and only a whisper of dune rise inland — nothing breaks the horizon.
    continentalness_to_base: [
      [0.0, 100],
      [0.12, 112],
      [0.24, 122],
      [0.34, 126],
      [0.42, 130],
      [0.6, 132],
      [0.8, 134],
      [1.0, 137],
    ],
    // Relief CRUSHED flatter than paradise: a becalmed world is a plane.
    erosion_to_amplitude: [
      [0.0, 10],
      [0.25, 7],
      [0.5, 4],
      [0.75, 3],
      [1.0, 2],
    ],
    // The gentlest swing in the fan-out — soft shoal dips, soft cay rises, no drama.
    pv_to_relief: [
      [0.0, -0.25],
      [0.3, 0.0],
      [0.55, 0.1],
      [0.8, 0.25],
      [1.0, 0.4],
    ],
  }

  // --- 3D DENSITY / OVERHANG GATE (dead flat) -----------------------------------------------------
  base.density = {
    ...base.density,
    warp: { period: 260, octaves: 2, amp: 12 }, // near-still land forms
    detail: { period: 140, octaves: 4, amp: 12 },
    overhang: { erosion_max: 0.2, pv_min: 0.92, strength: 0.5 }, // effectively shut
  }

  // --- WATER OPTICS (GLASS — the becalm's money shot) ---------------------------------------------
  // Desaturated steel-blue body, pale milk-jade shallows, VERY low sigma and the longest see-through
  // window in the fan-out — a dead-calm sea you stare into forever (sound carries; so does sight).
  base.water = {
    body_color: [0.045, 0.1, 0.13], // desaturated steel blue — no tropical vividness
    shallow_color: [0.22, 0.3, 0.32], // pale milky jade
    sigma: [0.5, 0.28, 0.3], // glass clarity
    fade_start: 5.0, // the longest readable window in the fan-out
    tint_depth: 14.0,
    deep_floor: 0.18,
  }

  // --- TEXTURE IDENTITY (the BLEACHED / HUSHED palette) -------------------------------------------
  base.textures = {
    families: {
      sand: { sat: 0.25, val: 1.15 }, // bleached bone-white cays
      grass: { hue: -12, sat: 0.55, val: 0.95 }, // pale wind-dead dune grass
      foliage: { hue: -10, sat: 0.6, val: 0.9 }, // washed-out canopy
      stone: { sat: 0.5, val: 0.9 }, // pale coral-rock
      wood: { sat: 0.7, val: 0.8 }, // silvered driftwood timber
    },
  }

  // --- SKY ISLANDS OFF (an empty, becalmed sky) ---------------------------------------------------
  base.sky = { ...base.sky, enabled: false }

  // --- BIOME SELECTION: pin-only members gated out of climate placement ---------------------------
  // The no-pin `dead_calm` fabric is a natural ocean/beach/river climate mosaic (the low-cont shelf
  // keeps ocean dominant; the cays read beach). No bias needed — the sea wins by elevation.
  base.biome_selection = {
    ...base.biome_selection,
    weirdness_esoteric_threshold: 1.0,
  }

  // --- S-25 SUB-BIOME REGION LAYER (world-as-planet) — six becalmed sub-biomes --------------------
  // Terrain knobs LIVE on the classes (S-25+ region-driven terrain). Band edges at the MEASURED field
  // percentiles (probe_rdist method, seed silent-atoll-becalm: p13=0.295 p25=0.367 p65=0.578 p78=0.648
  // p88=0.715) — area split ≈ 13/12/40/13/10/12, the no-pin open sea widest. blend 0.05 cross-fades
  // borders. Pins name REGISTRY biomes.
  base.regions = {
    enabled: true,
    field: { period: 1700, octaves: 2 }, // broad becalmed reaches (~0.85-1.7 km)
    warp: { period: 850, octaves: 2, amp: 320 }, // organic ring pockets
    blend: 0.05,
    variance: { period: 250, octaves: 2 },
    // TERRAIN KNOBS (S-25+ region-driven terrain, own settings): becalmed-atoll morphology — the reef
    // bars stay just submerged, sedge isles and palm rings rise barely above the glass, the cays stand as
    // low smooth dunes, the drift channels sink between the rings. Everything LOW — a hushed flat world.
    classes: [
      { name: 'reef_bar', upto: 0.295, biome: 'beach', relief_scale: 0.4, height_bias: -2, roughness_scale: 0.4 }, // just-submerged coral bars + shoals (~13%)
      { name: 'hush_meadow', upto: 0.367, biome: 'grassland', relief_scale: 0.5, height_bias: 2, roughness_scale: 0.5 }, // pale sedge isles barely above the glass (~12%)
      { name: 'dead_calm', upto: 0.578 }, // NO PIN — dominant (~40%), the glassy sea/cay fabric (identity)
      { name: 'bleached_cay', upto: 0.648, biome: 'desert', relief_scale: 0.8, height_bias: 3, roughness_scale: 0.6 }, // low smooth bone-white dune cays (~13%)
      { name: 'pale_grove', upto: 0.715, biome: 'tropical', relief_scale: 0.6, height_bias: 2, roughness_scale: 0.7 }, // hushed palm rings (~10%)
      { name: 'drift_channel', upto: 1.01, biome: 'river', relief_scale: 0.5, height_bias: -5, roughness_scale: 0.6 }, // sunken still channels between the rings (~12%)
    ],
  }

  // --- STRUCTURE POOL OVERRIDES (REGISTRY-name keys) ----------------------------------------------
  // pool_coral = the water-anchor reef (paradise-proven, live): submerged fans on the glass shelf —
  // ocean carries it so the reef reads through the dead-calm water everywhere, beach adds it at the
  // shoals. Pale boulder accents elsewhere.
  base.structure_pool_overrides = {
    ocean: ['pool_coral'],
    beach: ['pool_coral'],
    tropical: ['pool_rocks_tropical'],
    desert: ['pool_rocks_sandstone'],
    grassland: ['pool_rocks_granite'],
  }

  // --- TREE SPECIES (REGISTRY-name keys — hushed, sparse) -----------------------------------------
  // tropical drops its jungle_giant for quiet curved palms (a hushed grove, not a jungle); the cays
  // grow driftwood snags + a rare palm; the meadows a lone palm. beach keeps DEFAULT palms.
  base.tree_species = {
    ...base.tree_species,
    tropical: [
      { species: 'palm_curve', weight: 3 },
      { species: 'dead_snag', weight: 1 },
    ],
    desert: [
      { species: 'dead_snag', weight: 2 },
      { species: 'palm_curve', weight: 1 },
    ],
    grassland: [{ species: 'palm_curve', weight: 1 }],
  }

  // --- DECORATION (hushed and sparse — silence reads as emptiness) --------------------------------
  base.decoration = {
    ...base.decoration,
    tree_grove_one_in: 6, // (DEFAULT 3) lonely stands with long bare reaches between
    flower_patch_one_in: 12, // few blooms — a becalmed world, not a garden
    // No temperate tall grass / fern / reeds (no wind to bend them, no marsh); shore litter instead:
    // dune grass, shells, starfish, driftwood — and coral fans under the glass.
    sprites: {
      tall_grass: false,
      fern: false,
      reed: false,
      coral: true,
      dune_grass: true,
      seashell: true,
      starfish: true,
      driftwood: true,
    },
  }

  // --- BIOME TABLE: REGISTRY names/ids. UNGATED fabric = ocean/beach/river (the no-pin mosaic);
  // GATED pin-only = grassland/desert/tropical. All beds pale sand (a bleached world under glass).
  base.biomes = [
    {
      id: 0,
      name: 'ocean',
      // Pulled toward the FIELD MEANS (the fen fabric lesson, applied to a SEA world): the registry
      // point (cont 0.05) only wins the rare deep-field samples, so the becalmed sea LABELLED river —
      // wrong music, wrong fabric. At cont 0.3 + weight 1.5 the ocean wins the broad drowned shelf.
      climate: { temperature: 0.55, humidity: 0.6, continentalness: 0.3, erosion: 0.8, pv: 0.3 },
      weight: 1.5,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'sand', underwater: 'sand', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: ['pool_coral'],
      music_bed: 'ocean',
    }, // the dead-calm sea — pale sand floor under glass
    {
      id: 1,
      name: 'beach',
      climate: { temperature: 0.6, humidity: 0.5, continentalness: 0.32, erosion: 0.85, pv: 0.45 },
      weight: 1.2,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'sand', underwater: 'sand', filler: 'stone' },
      tree_density: 0.015,
      grass_density: 0.04,
      structure_pools: ['pool_coral'],
      music_bed: 'beach',
    }, // the cay shores — bleached sand, sparse palms
    {
      id: 2,
      name: 'river',
      // COOLED off the field means (the pandora river lesson) so it keeps ONLY the true pv≈0 channel
      // valleys instead of stealing the whole sea fabric from ocean.
      climate: { temperature: 0.4, humidity: 0.75, continentalness: 0.55, erosion: 0.7, pv: 0.02 },
      weight: 1.1,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
      tree_density: 0.03,
      grass_density: 0.25,
      structure_pools: [],
      music_bed: 'river',
    }, // still channels threading the rings
    // PIN-ONLY members (weirdness_gate:true ⇒ region pins only).
    {
      id: 3,
      name: 'grassland',
      climate: { temperature: 0.6, humidity: 0.45, continentalness: 0.6, erosion: 0.85, pv: 0.5 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
      tree_density: 0.02,
      grass_density: 0.5,
      structure_pools: ['pool_rocks_granite'],
      music_bed: 'grassland',
    }, // hush_meadow — pale sedge isles
    {
      id: 10,
      name: 'desert',
      climate: { temperature: 0.75, humidity: 0.2, continentalness: 0.55, erosion: 0.85, pv: 0.5 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'sand', subsurface: 'sand', underwater: 'sand', filler: 'stone' },
      tree_density: 0.01,
      grass_density: 0.06,
      structure_pools: ['pool_rocks_sandstone'],
      music_bed: 'beach',
    }, // bleached_cay — bone-white dune backs
    {
      id: 12,
      name: 'tropical',
      climate: { temperature: 0.75, humidity: 0.7, continentalness: 0.6, erosion: 0.78, pv: 0.48 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
      tree_density: 0.12,
      grass_density: 0.5,
      structure_pools: ['pool_rocks_tropical'],
      music_bed: 'beach',
    }, // pale_grove — hushed palm rings
  ]

  return base
}

/** The SILENT ATOLL world recipe (world 15) — pass to `create_engine({ world_config })`. */
export const SILENT_ATOLL_WORLD = build_silent_atoll()
