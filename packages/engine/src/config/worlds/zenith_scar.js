// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD 20 · ZENITH SCAR (on-chain `20_zenith_scar`, biome `fractured_zenith`) — the endgame wound.
// Seed identity (seed/mainnet/20_zenith_scar/world.json): earth+water elements, "the scar — reality
// frays at the zenith; the last wall before the wound", the L200 wall, the Last Guardian, wisdom lean.
// The engine identity: a FRACTURED WORLD-WOUND — the most violent relief contrast in the fan-out:
// torn violet-grey walls over DEEP FLOODED SCAR CHANNELS (low continentalness plunges under the sea —
// the wound water, eerie cyan-violet), a deep warped canyon carve tearing the walls (the scar itself),
// exposed world-strata on every steep face, black fracture teeth, sludge-mired wound margins, and
// reality-fray pockets. the_sundering (16) is the dry-rift cousin; the scar is the WET wound — earth
// torn open and water pooled in the tear.
//
// ─── ARCHITECTURE (the S-25 fan-out pattern) ────────────────────────────────────────────────────────────
// A CLASSIC-SPLINE world (massif OFF): the region layer's terrain knobs WERE inert pre-2026-07-13 — now LIVE on the spline path (S-25+ region-driven terrain, column_gen.raw_land_no_cirque; see TERRAIN KNOBS on the classes) (the classes below carry them). The region layer PINS the BIOME per column; the WOUND identity
// comes from the extreme splines (sub-sea scar floors ↔ tall fracture walls), the deep warped canyon
// stage, the wide overhang gate (torn lips), and slope-gated STRATA (the exposed world-layers).
//
// DECORATION-KEY LAW (surface_decorator.js:491): `structure_pool_overrides` + `tree_species` keys are
// REGISTRY names (the paradise idiom); evocative names ride the region CLASSES. alpine / obsidian_spires
// / crystal_hollows / void_marsh have NO BIOME_SCHEMATICS row ⇒ overrides-only schematics fire (live).

import { DEFAULT_WORLD_GEN_CONFIG } from '../world_gen_config.js'

/** @typedef {import('../world_gen_config.js').WorldGenConfig & { name: string, biome_pin: string }} NamedWorldConfig */

/**
 * Builds the zenith-scar recipe: a deep clone of the live DEFAULT (inherits every field this lane
 * does not tune, so it tracks the schema) + the world-wound overrides + the world identity metadata.
 * @returns {NamedWorldConfig}
 */
function build_zenith_scar() {
  const base = /** @type {NamedWorldConfig} */ (structuredClone(DEFAULT_WORLD_GEN_CONFIG))

  base.name = 'zenith_scar'
  base.biome_pin = 'fractured_zenith'
  base.seed = 'zenith-scar-wound' // probed for the region-field percentiles below (probe_rdist method)
  base.version = 1 // zenith-scar recipe lineage v1 (config_hash differs from DEFAULT + every sibling)

  // --- CLIMATE FIELD FREQUENCIES (noise) — the terrain-variety source on a spline world ----------
  // continentalness SHORTER (4096→3000) ⇒ the land tears into more wound channels per walk; erosion
  // longer ⇒ broad wall belts vs flat fray plains; weirdness near-DEFAULT ⇒ jagged tooth chains.
  base.noise = {
    ...base.noise,
    continentalness: { period: 3000, octaves: 6, spread: 2, gain: 0.5 }, // more tears per horizon
    erosion: { period: 1300, octaves: 6, spread: 2, gain: 0.5 }, // broad wall belts
    weirdness: { period: 520, octaves: 4, spread: 2, gain: 0.5 }, // jagged fracture chains
  }

  // --- TERRAIN SHAPING SPLINES (the wound: flooded tears ↔ the last walls) ------------------------
  base.splines = {
    // EXTREME contrast: low continentalness PLUNGES well under the waterline (the flooded scar
    // channels — the wound water), then climbs to the highest dry backs in the spline family.
    continentalness_to_base: [
      [0.0, 106],
      [0.18, 124],
      [0.35, 134],
      [0.6, 148],
      [0.85, 160],
      [1.0, 170],
    ],
    // WALL amplitude: the last walls — tall at low erosion, collapsing to flat fray plains.
    // Peak math: 170 + 140 ≈ 310 ≪ the 382 cap.
    erosion_to_amplitude: [
      [0.0, 140],
      [0.25, 100],
      [0.5, 54],
      [0.75, 24],
      [1.0, 8],
    ],
    // TORN curve: a DEEP negative dip (the pv tears flood too), flat mid-shoulders, then a hard ramp
    // to full wall relief — sheer fracture faces over still water.
    pv_to_relief: [
      [0.0, -0.55],
      [0.28, -0.2],
      [0.5, 0.05],
      [0.75, 0.4],
      [0.9, 0.8],
      [1.0, 1.0],
    ],
  }

  // --- 3D DENSITY / OVERHANG GATE (torn fracture lips) --------------------------------------------
  base.density = {
    ...base.density,
    warp: { period: 270, octaves: 3, amp: 32 }, // torn, sheared wall faces
    detail: { period: 130, octaves: 5, amp: 36 }, // sharp fracture detail
    overhang: { erosion_max: 0.5, pv_min: 0.5, strength: 1.7 }, // walls undercut into torn lips
  }

  // --- CANYON STAGE (THE SCAR — the deepest carve in the fan-out) ---------------------------------
  // A second, deeper wound network tears the wall belts; where it cuts below the waterline the scar
  // floods (the earth+water read: water pooled in the tear).
  base.carvers = { ...base.carvers, canyon: { enabled: true, width: 0.09, depth: 70, wall_steepness: 3.2, warp: true } }

  // --- STRATA BANDING (the EXPOSED WORLD-LAYERS on every torn face) -------------------------------
  base.strata = {
    ...base.strata,
    enabled: true,
    band_height: 7,
    band_jitter: 5, // wavering layers — torn geology, not masonry (the choir's opposite)
    slope_gate: 1.3, // sheer wound walls only
    palette: ['stone', 'dirt', 'sand'], // violet rock / dark seam / pale fray band (recolored below)
  }

  // --- WATER OPTICS (the wound water — eerie luminous cyan-violet, unnatural) ---------------------
  base.water = {
    body_color: [0.03, 0.05, 0.12], // deep violet
    shallow_color: [0.14, 0.3, 0.42], // unnatural luminous cyan margin
    sigma: [1.1, 0.5, 0.4], // blue-cyan carries — light where none should be
    fade_start: 2.5,
    tint_depth: 8.0,
    deep_floor: 0.2, // the fray-glow residual
  }

  // --- TEXTURE IDENTITY (the FRACTURED VIOLET-GREY endgame palette) -------------------------------
  base.textures = {
    families: {
      stone: { hue: 230, sat: 0.5, val: 0.6 }, // cold violet-grey wound rock
      dirt: { hue: 250, sat: 0.7, val: 0.5 }, // dark violet-brown seams
      grass: { hue: -20, sat: 0.5, val: 0.6 }, // ashen last-scrub
      foliage: { hue: -18, sat: 0.55, val: 0.55 },
      sand: { hue: 220, sat: 0.4, val: 0.8 }, // pale grey fray dust
      wood: { sat: 0.7, val: 0.5 }, // grey weathered snag timber
    },
  }

  // --- SKY ISLANDS OFF (nothing drifts over the wound — 16/19 own the sky) ------------------------
  base.sky = { ...base.sky, enabled: false }

  // --- BIOME SELECTION: pin-only members gated out of climate placement ---------------------------
  base.biome_selection = {
    ...base.biome_selection,
    weirdness_esoteric_threshold: 1.0,
  }

  // --- S-25 SUB-BIOME REGION LAYER (world-as-planet) — six wound sub-biomes -----------------------
  // Terrain knobs LIVE on the classes (S-25+ region-driven terrain). Band edges at the MEASURED field
  // percentiles (probe_rdist method, seed zenith-scar-wound: p13=0.312 p25=0.39 p65=0.561 p78=0.626
  // p88=0.688) — area split ≈ 13/12/40/13/10/12, the no-pin scar country widest, the sear flats the
  // rare burn. blend 0.05 cross-fades borders. Pins name REGISTRY biomes.
  base.regions = {
    enabled: true,
    field: { period: 1900, octaves: 2 }, // vast endgame regions (~0.95-1.9 km)
    warp: { period: 950, octaves: 2, amp: 350 }, // torn band pockets
    blend: 0.05,
    variance: { period: 260, octaves: 2 },
    // TERRAIN KNOBS (S-25+ region-driven terrain, own settings): the endgame wound gets the most violent
    // regional contrast in the fan-out — rim walls tower highest, shatter teeth spike roughest, the wound
    // mire sinks to the eerie water, fray pockets sag into unreal dips, the old-burn flats lie searing-flat.
    classes: [
      { name: 'rim_walls', upto: 0.312, biome: 'alpine', relief_scale: 1.7, height_bias: 12, roughness_scale: 1.6 }, // the LAST WALLS — towering violet crests (~13%)
      { name: 'wound_mire', upto: 0.39, biome: 'void_marsh', relief_scale: 0.4, height_bias: -5, roughness_scale: 0.6 }, // sunken sludge margins of the wound water (~12%)
      { name: 'the_scar', upto: 0.561 }, // NO PIN — dominant (~40%), the torn rock/channel fabric (identity)
      {
        name: 'fray_pockets',
        upto: 0.626,
        biome: 'crystal_hollows',
        relief_scale: 0.6,
        height_bias: -6,
        roughness_scale: 1.0,
      }, // reality-fray dips (~13%)
      {
        name: 'sear_flats',
        upto: 0.688,
        biome: 'scorched_badlands',
        relief_scale: 0.35,
        height_bias: 0,
        roughness_scale: 0.5,
      }, // searing-flat old-burn country (~10%)
      {
        name: 'shatter_teeth',
        upto: 1.01,
        biome: 'obsidian_spires',
        relief_scale: 1.6,
        height_bias: 6,
        roughness_scale: 1.7,
      }, // black fracture teeth — roughest (~12%)
    ],
  }

  // --- STRUCTURE POOL OVERRIDES (REGISTRY-name keys) ----------------------------------------------
  // The no-row pins fire overrides-only scatter: torn boulders on the walls, drowned snags + mud in
  // the mire, ruin-stones in the fray, volcanic black on the teeth. The ashen flats get dead stands.
  base.structure_pool_overrides = {
    alpine: ['pool_rocks_alpine', 'pool_rocks_volcanic'],
    void_marsh: ['pool_dead_trees', 'pool_mud_mounds'],
    crystal_hollows: ['pool_rocks_granite'],
    obsidian_spires: ['pool_rocks_volcanic'],
    grassland: ['pool_dead_trees', 'pool_rocks_granite'],
  }

  // --- TREE SPECIES (REGISTRY-name keys — the last gnarled survivors) -----------------------------
  // alpine EMPTIED (bare walls); the ashen flats grow snag-dominant last stands; the channel banks a
  // lone snag. scorched_badlands is treeless by its base row (tree_one_in 0).
  base.tree_species = {
    ...base.tree_species,
    alpine: [],
    grassland: [
      { species: 'dead_snag', weight: 2 },
      { species: 'oak_broadleaf', weight: 1 },
    ],
    river: [{ species: 'dead_snag', weight: 1 }],
  }

  // --- DECORATION (a dying world — debris, lichen, no cheer) --------------------------------------
  base.decoration = {
    ...base.decoration,
    tree_grove_one_in: 7, // (DEFAULT 3) rare last stands
    rock_grove_one_in: 4, // (DEFAULT 6) heavy fracture debris
    flower_patch_one_in: 18, // almost nothing blooms at the wall
    sprites: {
      tall_grass: false,
      flower: false,
      lichen: true,
      moss_tuft: true,
      pebbles: true,
      dead_branch: true,
    },
  }

  // --- BIOME TABLE: REGISTRY names/ids. UNGATED fabric = ocean/river/grassland/alpine (the no-pin
  // torn mosaic — wound channels + ashen flats + bare walls); GATED pin-only = void_marsh/
  // crystal_hollows/scorched_badlands/obsidian_spires. Dark beds under the wound water.
  base.biomes = [
    {
      id: 0,
      name: 'ocean',
      climate: { temperature: 0.45, humidity: 0.6, continentalness: 0.05, erosion: 0.8, pv: 0.3 },
      weight: 1.4,
      weirdness_gate: false,
      land: { surface: 'dirt', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: [],
      music_bed: 'ocean',
    }, // the flooded scar channels — dark beds under violet water
    {
      id: 2,
      name: 'river',
      climate: { temperature: 0.45, humidity: 0.65, continentalness: 0.55, erosion: 0.7, pv: 0.02 },
      weight: 1.2,
      weirdness_gate: false,
      land: { surface: 'dirt', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
      tree_density: 0.03,
      grass_density: 0.3,
      structure_pools: [],
      music_bed: 'river',
    }, // the tear-fed channels threading the fabric
    {
      id: 3,
      name: 'grassland',
      climate: { temperature: 0.5, humidity: 0.4, continentalness: 0.65, erosion: 0.85, pv: 0.45 },
      weight: 1.1,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.02,
      grass_density: 0.45,
      structure_pools: ['pool_dead_trees', 'pool_rocks_granite'],
      music_bed: 'esoteric',
    }, // the ashen fray plains of the fabric
    {
      id: 13,
      name: 'alpine',
      climate: { temperature: 0.4, humidity: 0.35, continentalness: 0.7, erosion: 0.15, pv: 0.85 },
      weight: 1.1,
      weirdness_gate: false,
      land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0.04,
      structure_pools: ['pool_rocks_alpine'],
      music_bed: 'esoteric',
    }, // the torn walls of the fabric
    // PIN-ONLY members (weirdness_gate:true ⇒ region pins only).
    {
      id: 16,
      name: 'void_marsh',
      climate: { temperature: 0.4, humidity: 0.95, continentalness: 0.55, erosion: 0.95, pv: 0.25 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'dirt', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.02,
      grass_density: 0.08,
      structure_pools: ['pool_dead_trees', 'pool_mud_mounds'],
      music_bed: 'esoteric',
    }, // wound_mire — sludge at the water's lip
    {
      id: 14,
      name: 'crystal_hollows',
      climate: { temperature: 0.5, humidity: 0.5, continentalness: 0.75, erosion: 0.5, pv: 0.6 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'dirt', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.01,
      grass_density: 0.15,
      structure_pools: ['pool_rocks_granite'],
      music_bed: 'esoteric',
    }, // fray_pockets — where reality thins
    {
      id: 11,
      name: 'scorched_badlands',
      climate: { temperature: 0.9, humidity: 0.15, continentalness: 0.7, erosion: 0.4, pv: 0.62 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'sand', subsurface: 'dirt', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0.02,
      structure_pools: ['pool_rocks_volcanic', 'pool_rocks_sandstone'],
      music_bed: 'desert',
    }, // sear_flats — the old burn before the wall
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
    }, // shatter_teeth — the black fracture line
  ]

  return base
}

/** The ZENITH SCAR world recipe (world 20) — pass to `create_engine({ world_config })`. */
export const ZENITH_SCAR_WORLD = build_zenith_scar()
