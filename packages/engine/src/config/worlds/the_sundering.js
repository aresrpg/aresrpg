// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD 16 · THE SUNDERING (on-chain `16_the_sundering`, biome `sundered_waste`) — the shattered-rift
// planet. Seed identity (seed/mainnet/16_the_sundering/world.json): fire+air elements, "the rift —
// gravity thins at the sundering; falls are slow and the ash never lands", the L100 gate (first
// gatherless world), strength lean. The engine identity: a BONE-DRY SHATTERED WASTE — violent badland
// relief torn by deep rift chasms (the cranked canyon carver), hard basalt teeth spiking off the flats,
// black glass scars, weird gate-hollows — and SHARD-FIELDS ADRIFT overhead (sky islands ON: the ash
// that never lands). ember_steppe (world 03) is the dry-world prior art; pandora_reach the sky-layer
// prior art (its validator-proven band numbers reused).
//
// ─── ARCHITECTURE (the S-25 fan-out pattern) ────────────────────────────────────────────────────────────
// A CLASSIC-SPLINE world (massif OFF): the region layer's terrain knobs WERE inert pre-2026-07-13 — now LIVE on the spline path (S-25+ region-driven terrain, column_gen.raw_land_no_cirque; see TERRAIN KNOBS on the classes) (the classes below carry them). The region layer PINS the BIOME per column; TERRAIN VIOLENCE
// comes from the tuned climate splines (erosion→amplitude mesa belts, pv→spike teeth), the wide-open
// overhang gate, and the deep warped canyon stage (the rifts).
//
// DECORATION-KEY LAW (surface_decorator.js:491): `structure_pool_overrides` + `tree_species` keys are
// REGISTRY names (the paradise idiom); evocative names ride the region CLASSES. alpine / obsidian_spires
// / crystal_hollows have NO BIOME_SCHEMATICS row ⇒ overrides-only volcanic rock schematics fire at the
// fallback density (the ember/pandora path, live).

import { DEFAULT_WORLD_GEN_CONFIG } from '../world_gen_config.js'

/** @typedef {import('../world_gen_config.js').WorldGenConfig & { name: string, biome_pin: string }} NamedWorldConfig */

/**
 * Builds the sundering recipe: a deep clone of the live DEFAULT (inherits every field this lane does
 * not tune, so it tracks the schema) + the shattered-rift overrides + the world identity metadata.
 * @returns {NamedWorldConfig}
 */
function build_the_sundering() {
  const base = /** @type {NamedWorldConfig} */ (structuredClone(DEFAULT_WORLD_GEN_CONFIG))

  base.name = 'the_sundering'
  base.biome_pin = 'sundered_waste'
  base.seed = 'sundering-hadean-rift' // probed for the region-field percentiles below (probe_rdist method)
  base.version = 1 // the-sundering recipe lineage v1 (config_hash differs from DEFAULT + every sibling)

  // --- CLIMATE FIELD FREQUENCIES (noise) — the terrain-variety source on a spline world ----------
  // erosion shorter ⇒ tighter alternation of violent badland belts vs ash basins; weirdness shorter ⇒
  // the PV fold-ridges the basalt teeth spike along pack into dense broken chains.
  base.noise = {
    ...base.noise,
    erosion: { period: 1200, octaves: 6, spread: 2, gain: 0.5 }, // (was 1024) tight shattered belts
    weirdness: { period: 480, octaves: 4, spread: 2, gain: 0.5 }, // (was 512) dense tooth chains
  }

  // --- TERRAIN SHAPING SPLINES (the violent waste) ------------------------------------------------
  base.splines = {
    // High dry inland — everything far above the dropped sea (8): a landlocked waste, no coast.
    continentalness_to_base: [
      [0.0, 126],
      [0.2, 140],
      [0.45, 152],
      [0.7, 162],
      [1.0, 174],
    ],
    // VIOLENT amplitude: the tallest badland walls in the dry family, collapsing to ash flats.
    // Peak math: 174 + 130 ≈ 304 ≪ the 382 cap (headroom under the shard band).
    erosion_to_amplitude: [
      [0.0, 130],
      [0.25, 95],
      [0.5, 55],
      [0.75, 26],
      [1.0, 10],
    ],
    // TOOTH curve: flat floors across the low/mid PV range, then a hard ramp — sudden basalt teeth.
    pv_to_relief: [
      [0.0, -0.2],
      [0.32, 0.0],
      [0.58, 0.18],
      [0.78, 0.55],
      [0.9, 0.85],
      [1.0, 1.0],
    ],
  }

  // --- 3D DENSITY / OVERHANG GATE (shattered undercut teeth) --------------------------------------
  base.density = {
    ...base.density,
    warp: { period: 280, octaves: 3, amp: 34 }, // torn, non-repeating tooth faces
    detail: { period: 130, octaves: 5, amp: 38 }, // jagged fracture detail
    // Wide-open gate + hard strength ⇒ the teeth undercut into genuinely broken silhouettes.
    overhang: { erosion_max: 0.5, pv_min: 0.5, strength: 1.8 },
  }

  // --- CANYON STAGE (THE RIFT — the deepest carve in the fan-out) ---------------------------------
  // The sundering itself: a deep, steep-walled, warped chasm network tearing the waste apart.
  base.carvers = { ...base.carvers, canyon: { enabled: true, width: 0.08, depth: 60, wall_steepness: 3, warp: true } }

  // --- HYDROLOGY (BONE DRY — the ember idiom: fire+air has no water) ------------------------------
  // Sea dropped far below the waste floor; rivers + lakes disabled via impossible gates.
  base.hydrology = {
    ...base.hydrology,
    sea_level: 8,
    river: { ...base.hydrology.river, continentalness_min: 1.0 }, // never satisfied ⇒ no channels
    lake: { ...base.hydrology.lake, threshold: 1.0 }, // never satisfied ⇒ no ponds
  }

  // --- WATER OPTICS (residual ember pools — dim, red-shifted, near-opaque) ------------------------
  base.water = {
    body_color: [0.08, 0.03, 0.03], // dark ember red-black
    shallow_color: [0.22, 0.08, 0.05], // dim molten margin
    sigma: [0.7, 1.7, 2.0], // red survives, green/blue die ⇒ hot tint
    fade_start: 1.0,
    tint_depth: 3.0,
    deep_floor: 0.12,
  }

  // --- TEXTURE IDENTITY (the SUNDERED BASALT / ASH palette) ---------------------------------------
  base.textures = {
    families: {
      stone: { sat: 0.45, val: 0.4 }, // dark rift basalt
      sand: { hue: -4, sat: 0.3, val: 0.66 }, // grey falling ash
      dirt: { hue: -8, sat: 1.1, val: 0.45 }, // seared red-brown seams
      grass: { hue: -18, sat: 0.5, val: 0.55 }, // scorched survivor scrub
      foliage: { hue: -18, sat: 0.5, val: 0.5 },
      wood: { sat: 0.8, val: 0.38 }, // charred snag timber
    },
  }

  // --- SKY ISLANDS ON (the shard-fields — "the ash never lands") ----------------------------------
  // The rift's thinned gravity holds broken shards adrift over the waste. Island SHAPE params stay
  // DEFAULT (they satisfy the validator's band/reach constraints: thickness 116 ≥ cap_radius_max·
  // root_ratio_max = 114.4); the pandora-proven band (286-344) pulls the field into sight of the teeth.
  base.sky = {
    ...base.sky,
    enabled: true,
    region_rate: 0.28, // (was 0.13) most sky regions host a shard-field
    islands_min: 3,
    islands_max: 9, // (was 8) crowded drift
    low_y: 286, // (was 300) presence over the waste
    high_y: 344, // (was 352) keeps crown + thickness inside the box
  }

  // --- BIOME SELECTION: pin-only members gated out of climate placement ---------------------------
  base.biome_selection = {
    ...base.biome_selection,
    weirdness_esoteric_threshold: 1.0,
  }

  // --- S-25 SUB-BIOME REGION LAYER (world-as-planet) — six sundered sub-biomes --------------------
  // Terrain knobs LIVE on the classes (S-25+ region-driven terrain). Band edges at the MEASURED field
  // percentiles (probe_rdist method, seed sundering-hadean-rift: p13=0.293 p25=0.358 p65=0.557
  // p78=0.629 p88=0.691) — area split ≈ 13/12/40/13/10/12, the no-pin waste widest, the gate hollows
  // the rare dread pocket. blend 0.05 cross-fades borders. Pins name REGISTRY biomes.
  base.regions = {
    enabled: true,
    field: { period: 1800, octaves: 2 }, // big violent regions (~0.9-1.8 km)
    warp: { period: 900, octaves: 2, amp: 340 }, // torn band pockets
    blend: 0.05,
    variance: { period: 250, octaves: 2 },
    // TERRAIN KNOBS (S-25+ region-driven terrain, own settings): the shattered waste's violence gets
    // regional grammar — basalt teeth spike highest + roughest, the glass scars lie flat and dead, seared
    // belts break rough, the ash dune seas roll smooth, the gate hollows SINK into weird sunken pockets.
    classes: [
      { name: 'rift_teeth', upto: 0.293, biome: 'alpine', relief_scale: 1.7, height_bias: 10, roughness_scale: 1.7 }, // bare basalt tooth country — the violent peak (~13%)
      {
        name: 'glass_scar',
        upto: 0.358,
        biome: 'obsidian_spires',
        relief_scale: 0.4,
        height_bias: -2,
        roughness_scale: 0.5,
      }, // flat black shatter-fields (~12%)
      { name: 'sundered_waste', upto: 0.557 }, // NO PIN — dominant (~40%), the scorched/desert/alpine fabric (identity)
      {
        name: 'cinder_brakes',
        upto: 0.629,
        biome: 'scorched_badlands',
        relief_scale: 1.2,
        height_bias: 2,
        roughness_scale: 1.4,
      }, // broken lava-glint seared belts (~13%)
      { name: 'ash_dunes', upto: 0.691, biome: 'desert', relief_scale: 0.7, height_bias: 0, roughness_scale: 0.5 }, // smooth grey falling-ash dune seas (~10%)
      {
        name: 'gate_hollow',
        upto: 1.01,
        biome: 'crystal_hollows',
        relief_scale: 0.5,
        height_bias: -8,
        roughness_scale: 0.9,
      }, // sunken Hadean-gate pockets (~12%)
    ],
  }

  // --- STRUCTURE POOL OVERRIDES (REGISTRY-name keys) ----------------------------------------------
  // alpine / obsidian_spires / crystal_hollows have no BIOME_SCHEMATICS row ⇒ overrides-only volcanic
  // scatter (the ember idiom). scorched_badlands' base row already glints SCORCHED_ROCK_LAVA.
  base.structure_pool_overrides = {
    alpine: ['pool_rocks_volcanic'],
    obsidian_spires: ['pool_rocks_volcanic'],
    crystal_hollows: ['pool_rocks_volcanic'],
    scorched_badlands: ['pool_rocks_volcanic'],
    desert: ['pool_rocks_sandstone', 'pool_rocks_volcanic'],
  }

  // --- TREE SPECIES (REGISTRY-name keys — a gatherless waste grows almost nothing) ----------------
  // desert keeps a lone snag; alpine is EMPTIED (bare teeth — the everest far-mirror class);
  // scorched_badlands is treeless by its base row (tree_one_in 0).
  base.tree_species = {
    ...base.tree_species,
    alpine: [],
    desert: [{ species: 'dead_snag', weight: 1 }],
  }

  // --- DECORATION (a shattered waste — rock scatter IS the texture) -------------------------------
  base.decoration = {
    ...base.decoration,
    tree_grove_one_in: 9, // (DEFAULT 3) almost no stands
    rock_grove_one_in: 4, // (DEFAULT 6) dense broken-rock scatter
    // No living clutter beyond wind-strewn debris.
    sprites: {
      tall_grass: false,
      fern: false,
      flower: false,
      reed: false,
      dead_branch: true,
      pebbles: true,
    },
  }

  // --- BIOME TABLE: REGISTRY names/ids. UNGATED fabric = desert/scorched_badlands/alpine (the no-pin
  // waste mosaic); GATED pin-only = obsidian_spires/crystal_hollows. NO ocean/river member — the
  // landlocked base + dropped sea leave no sub-sea columns.
  base.biomes = [
    {
      id: 10,
      name: 'desert',
      climate: { temperature: 0.9, humidity: 0.1, continentalness: 0.55, erosion: 0.82, pv: 0.45 },
      weight: 1.1,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'dirt', underwater: 'stone', filler: 'stone' },
      tree_density: 0.005,
      grass_density: 0.03,
      structure_pools: ['pool_rocks_sandstone'],
      music_bed: 'desert',
    }, // the ash flats of the waste fabric
    {
      id: 11,
      name: 'scorched_badlands',
      climate: { temperature: 0.95, humidity: 0.15, continentalness: 0.65, erosion: 0.45, pv: 0.6 },
      weight: 1.2,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'dirt', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0.02,
      structure_pools: ['pool_rocks_volcanic', 'pool_rocks_sandstone'],
      music_bed: 'desert',
    }, // seared badland belts (lava-glint rocks via the base row)
    {
      id: 13,
      name: 'alpine',
      climate: { temperature: 0.75, humidity: 0.2, continentalness: 0.7, erosion: 0.15, pv: 0.85 },
      weight: 1.05,
      weirdness_gate: false,
      land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0.02,
      structure_pools: ['pool_rocks_volcanic'],
      music_bed: 'esoteric',
    }, // the basalt teeth + rift walls
    // PIN-ONLY members (weirdness_gate:true ⇒ region pins only).
    {
      id: 15,
      name: 'obsidian_spires',
      climate: { temperature: 0.7, humidity: 0.2, continentalness: 0.74, erosion: 0.1, pv: 0.92 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: ['pool_rocks_volcanic'],
      music_bed: 'esoteric',
    }, // glass_scar — black shatter-glass fields
    {
      id: 14,
      name: 'crystal_hollows',
      climate: { temperature: 0.5, humidity: 0.5, continentalness: 0.75, erosion: 0.5, pv: 0.6 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'dirt', subsurface: 'dirt', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0.05,
      structure_pools: ['pool_rocks_volcanic'],
      music_bed: 'esoteric',
    }, // gate_hollow — the weird rift pockets before the Hadean Gate
  ]

  return base
}

/** The SUNDERING world recipe (world 16) — pass to `create_engine({ world_config })`. */
export const THE_SUNDERING_WORLD = build_the_sundering()
