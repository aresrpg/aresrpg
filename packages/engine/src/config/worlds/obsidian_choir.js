// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD 17 · OBSIDIAN CHOIR (on-chain `17_obsidian_choir`, biome `volcanic_cathedral`) — the black-glass
// cathedral planet. Seed identity (seed/mainnet/17_obsidian_choir/world.json): fire+earth elements,
// "obsidian resonance — the choir sings; matching its pitch opens the pyre doors", resist-wall teaching,
// Velkarion's pyre, intelligence lean. The engine identity: RANKED VERTICAL ORDER — dense chains of tall
// obsidian columns (the choir) rising off dark cathedral floors, their steep faces coursed into regular
// strata bands (the naves), lava-glint galleries, dark ash cloisters, esoteric resonance hollows. Where
// the_sundering (16) is horizontal violence (rift chasms + sky shards), the choir is vertical order:
// denser column chains, banded walls, a silent sky.
//
// ─── ARCHITECTURE (the S-25 fan-out pattern) ────────────────────────────────────────────────────────────
// A CLASSIC-SPLINE world (massif OFF): the region layer's terrain knobs WERE inert pre-2026-07-13 — now LIVE on the spline path (S-25+ region-driven terrain, column_gen.raw_land_no_cirque; see TERRAIN KNOBS on the classes) (the classes below carry them). The region layer PINS the BIOME per column; the VERTICAL
// identity comes from the tuned splines (tall low-erosion amplitude + a hard pv knee ⇒ organ-pipe
// columns), the wide overhang gate (mushrooming pipe crowns), and slope-gated STRATA (the courses).
//
// DECORATION-KEY LAW (surface_decorator.js:491): `structure_pool_overrides` + `tree_species` keys are
// REGISTRY names (the paradise idiom); evocative names ride the region CLASSES. alpine / obsidian_spires
// / crystal_hollows have NO BIOME_SCHEMATICS row ⇒ overrides-only volcanic rock schematics fire (live).

import { DEFAULT_WORLD_GEN_CONFIG } from '../world_gen_config.js'

/** @typedef {import('../world_gen_config.js').WorldGenConfig & { name: string, biome_pin: string }} NamedWorldConfig */

/**
 * Builds the obsidian-choir recipe: a deep clone of the live DEFAULT (inherits every field this lane
 * does not tune, so it tracks the schema) + the glass-cathedral overrides + the world identity metadata.
 * @returns {NamedWorldConfig}
 */
function build_obsidian_choir() {
  const base = /** @type {NamedWorldConfig} */ (structuredClone(DEFAULT_WORLD_GEN_CONFIG))

  base.name = 'obsidian_choir'
  base.biome_pin = 'volcanic_cathedral'
  base.seed = 'obsidian-choir-pyre' // probed for the region-field percentiles below (probe_rdist method)
  base.version = 1 // obsidian-choir recipe lineage v1 (config_hash differs from DEFAULT + every sibling)

  // --- CLIMATE FIELD FREQUENCIES (noise) — the terrain-variety source on a spline world ----------
  // weirdness SHORT (the pandora pillar lever) ⇒ the PV fold-ridges pack into dense column chains —
  // the ranked choir; erosion slightly shorter ⇒ tight column-belt vs floor alternation.
  base.noise = {
    ...base.noise,
    weirdness: { period: 420, octaves: 4, spread: 2, gain: 0.5 }, // (was 512) dense choir ranks
    erosion: { period: 1100, octaves: 6, spread: 2, gain: 0.5 }, // (was 1024) tight rank belts
  }

  // --- TERRAIN SHAPING SPLINES (the cathedral: flat naves + sudden organ pipes) -------------------
  base.splines = {
    // Dark rolling cathedral floor, all above the dropped sea (8) — a dry pyre world.
    continentalness_to_base: [
      [0.0, 122],
      [0.25, 136],
      [0.5, 146],
      [0.75, 154],
      [1.0, 162],
    ],
    // COLUMN amplitude: the tallest low-erosion walls in the dry family — the pipes — collapsing to
    // flat nave floors. Peak math: 162 + 150 ≈ 312 ≪ the 382 cap.
    erosion_to_amplitude: [
      [0.0, 150],
      [0.25, 110],
      [0.5, 60],
      [0.75, 26],
      [1.0, 8],
    ],
    // ORGAN-PIPE curve: dead-flat floors across the low/mid PV range, then a late hard knee — sheer
    // sudden columns, walkable naves between (the pandora spike curve, knee pushed later).
    pv_to_relief: [
      [0.0, -0.1],
      [0.35, 0.0],
      [0.6, 0.1],
      [0.75, 0.35],
      [0.9, 0.75],
      [1.0, 1.0],
    ],
  }

  // --- 3D DENSITY / OVERHANG GATE (mushrooming pipe crowns) ---------------------------------------
  base.density = {
    ...base.density,
    warp: { period: 260, octaves: 3, amp: 36 }, // meandering fluted column faces
    detail: { period: 125, octaves: 5, amp: 40 }, // sharp glassy undercut lips
    // Opens wide on the column columns and hits hard ⇒ crowned, undercut pipes over clean floors.
    overhang: { erosion_max: 0.55, pv_min: 0.5, strength: 2.0 },
  }

  // --- STRATA BANDING (the CATHEDRAL COURSES — the choir's masonry read) --------------------------
  // Slope-gated: only the sheer pipe/wall faces course into regular bands; low jitter keeps the
  // banding ORDERED (a cathedral is built, not eroded — the deliberate contrast with mesa strata).
  base.strata = {
    ...base.strata,
    enabled: true,
    band_height: 5,
    band_jitter: 2, // near-regular courses — the "ranked" read
    slope_gate: 1.25, // vertical faces only; floors keep their cover
    palette: ['stone', 'dirt', 'sand'], // obsidian course / ember seam / ash band (recolored below)
  }

  // --- HYDROLOGY (BONE DRY — a pyre cathedral has no water) ---------------------------------------
  base.hydrology = {
    ...base.hydrology,
    sea_level: 8,
    river: { ...base.hydrology.river, continentalness_min: 1.0 }, // never satisfied ⇒ no channels
    lake: { ...base.hydrology.lake, threshold: 1.0 }, // never satisfied ⇒ no ponds
  }

  // --- WATER OPTICS (residual pyre glow — near-opaque molten dim) ---------------------------------
  base.water = {
    body_color: [0.1, 0.03, 0.02], // deep pyre red-black
    shallow_color: [0.3, 0.1, 0.04], // molten-orange margin
    sigma: [0.55, 1.7, 2.1], // red penetrates, green/blue die ⇒ furnace tint
    fade_start: 1.0,
    tint_depth: 3.2,
    deep_floor: 0.12,
  }

  // --- TEXTURE IDENTITY (the OBSIDIAN / PYRE palette — the blackest stone in the fan-out) ---------
  base.textures = {
    families: {
      stone: { sat: 0.35, val: 0.32 }, // obsidian black — the hero rock
      dirt: { hue: -6, sat: 1.15, val: 0.42 }, // ember-red mortar seam
      sand: { hue: -6, sat: 0.35, val: 0.55 }, // dark cloister ash
      grass: { hue: -16, sat: 0.45, val: 0.5 }, // charcoal-olive remnants
      foliage: { hue: -16, sat: 0.5, val: 0.45 },
      wood: { sat: 0.75, val: 0.35 }, // scorched black timber
    },
  }

  // --- SKY ISLANDS OFF (a silent, held-breath sky — the choir sings alone) ------------------------
  base.sky = { ...base.sky, enabled: false }

  // --- BIOME SELECTION: pin-only members gated out of climate placement ---------------------------
  base.biome_selection = {
    ...base.biome_selection,
    weirdness_esoteric_threshold: 1.0,
  }

  // --- S-25 SUB-BIOME REGION LAYER (world-as-planet) — six cathedral sub-biomes -------------------
  // Terrain knobs LIVE on the classes (S-25+ region-driven terrain). Band edges at the MEASURED field
  // percentiles (probe_rdist method, seed obsidian-choir-pyre: p13=0.303 p25=0.371 p65=0.569
  // p78=0.635 p88=0.694) — area split ≈ 13/12/40/13/10/12, the no-pin floor widest, the nave the
  // rare monument. blend 0.05 cross-fades borders. Pins name REGISTRY biomes.
  base.regions = {
    enabled: true,
    field: { period: 1400, octaves: 2 }, // denser ranks (~0.7-1.4 km)
    warp: { period: 700, octaves: 2, amp: 280 }, // organic rank pockets
    blend: 0.05,
    variance: { period: 220, octaves: 2 },
    // TERRAIN KNOBS (S-25+ region-driven terrain, own settings): VERTICAL ORDER per region — the choir
    // ranks stand tallest, the great nave rises in ordered glass, the cloister courts lie hushed-flat,
    // the resonant hollows sink into echo pockets. The cathedral floor keeps the recipe's own dark fabric.
    classes: [
      { name: 'choir_ranks', upto: 0.303, biome: 'alpine', relief_scale: 1.6, height_bias: 10, roughness_scale: 1.5 }, // the ranked column country — tallest (~13%)
      {
        name: 'pyre_gallery',
        upto: 0.371,
        biome: 'scorched_badlands',
        relief_scale: 1.1,
        height_bias: 2,
        roughness_scale: 1.3,
      }, // broken lava-glint galleries (~12%)
      { name: 'cathedral_floor', upto: 0.569 }, // NO PIN — dominant (~40%), the dark floor fabric (identity)
      { name: 'ash_cloister', upto: 0.635, biome: 'desert', relief_scale: 0.35, height_bias: -1, roughness_scale: 0.4 }, // hushed dead-flat ash courts (~13%)
      {
        name: 'obsidian_nave',
        upto: 0.694,
        biome: 'obsidian_spires',
        relief_scale: 1.4,
        height_bias: 6,
        roughness_scale: 1.2,
      }, // the great ordered glass nave (~10%)
      {
        name: 'resonant_hollow',
        upto: 1.01,
        biome: 'crystal_hollows',
        relief_scale: 0.5,
        height_bias: -6,
        roughness_scale: 0.8,
      }, // sunken echo pockets (~12%)
    ],
  }

  // --- STRUCTURE POOL OVERRIDES (REGISTRY-name keys) ----------------------------------------------
  // The no-row pins (alpine/obsidian_spires/crystal_hollows) fire overrides-only volcanic scatter;
  // the cloister ash gets fallen sandstone blocks (broken masonry read).
  base.structure_pool_overrides = {
    alpine: ['pool_rocks_volcanic'],
    obsidian_spires: ['pool_rocks_volcanic'],
    crystal_hollows: ['pool_rocks_volcanic'],
    scorched_badlands: ['pool_rocks_volcanic'],
    desert: ['pool_rocks_volcanic', 'pool_rocks_sandstone'],
  }

  // --- TREE SPECIES (REGISTRY-name keys — a cathedral grows nothing green) ------------------------
  // alpine EMPTIED (bare ranked columns); desert keeps a lone charred snag in the cloisters;
  // scorched_badlands is treeless by its base row (tree_one_in 0).
  base.tree_species = {
    ...base.tree_species,
    alpine: [],
    desert: [{ species: 'dead_snag', weight: 1 }],
  }

  // --- DECORATION (bare floors, heavy rock scatter — fallen masonry everywhere) -------------------
  base.decoration = {
    ...base.decoration,
    tree_grove_one_in: 10, // (DEFAULT 3) near-treeless
    rock_grove_one_in: 3, // (DEFAULT 6) the densest rock scatter in the fan-out — rubble courses
    sprites: {
      tall_grass: false,
      fern: false,
      flower: false,
      reed: false,
      pebbles: true,
    },
  }

  // --- BIOME TABLE: REGISTRY names/ids. UNGATED fabric = desert/scorched_badlands/alpine (the no-pin
  // floor mosaic); GATED pin-only = obsidian_spires/crystal_hollows. NO ocean/river member — the
  // landlocked base + dropped sea leave no sub-sea columns.
  base.biomes = [
    {
      id: 10,
      name: 'desert',
      climate: { temperature: 0.85, humidity: 0.12, continentalness: 0.55, erosion: 0.82, pv: 0.45 },
      weight: 1.1,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'dirt', underwater: 'stone', filler: 'stone' },
      tree_density: 0.005,
      grass_density: 0.02,
      structure_pools: ['pool_rocks_sandstone'],
      music_bed: 'esoteric',
    }, // the dark ash floors of the fabric
    {
      id: 11,
      name: 'scorched_badlands',
      climate: { temperature: 0.95, humidity: 0.15, continentalness: 0.65, erosion: 0.45, pv: 0.6 },
      weight: 1.2,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'dirt', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0.01,
      structure_pools: ['pool_rocks_volcanic', 'pool_rocks_sandstone'],
      music_bed: 'desert',
    }, // pyre galleries (SCORCHED_ROCK_LAVA glints via the base row)
    {
      id: 13,
      name: 'alpine',
      climate: { temperature: 0.7, humidity: 0.2, continentalness: 0.7, erosion: 0.15, pv: 0.85 },
      weight: 1.05,
      weirdness_gate: false,
      land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0.02,
      structure_pools: ['pool_rocks_volcanic'],
      music_bed: 'esoteric',
    }, // the choir columns + coursed walls
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
    }, // obsidian_nave — the great glass hall
    {
      id: 14,
      name: 'crystal_hollows',
      climate: { temperature: 0.5, humidity: 0.5, continentalness: 0.75, erosion: 0.5, pv: 0.6 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'dirt', subsurface: 'dirt', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0.04,
      structure_pools: ['pool_rocks_volcanic'],
      music_bed: 'esoteric',
    }, // resonant_hollow — where the pitch answers back
  ]

  return base
}

/** The OBSIDIAN CHOIR world recipe (world 17) — pass to `create_engine({ world_config })`. */
export const OBSIDIAN_CHOIR_WORLD = build_obsidian_choir()
