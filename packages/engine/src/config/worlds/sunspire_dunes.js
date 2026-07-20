// WORLD 10 · SUNSPIRE DUNES (on-chain `10_sunspire_dunes`, biome `glass_desert`) — the golden-desert
// planet. Seed identity (seed/mainnet/10_sunspire_dunes/world.json): fire+earth elements, "mirages —
// false oases and mirage-cloaked elites; read the shimmer", "archimob country — elite density ×2; the
// Ensable Cavern under a true oasis". The engine identity: a GOLDEN DUNE SEA under glare — rolling
// dune country, red-rock mirage mesas, sun-fused glass flats, wind-carved sunspire karst, dry acacia
// scrub fringes — and the RARE TRUE OASIS: a lush palm pocket around real water in a bone-dry world.
//
// EMBER/MISTRAL CONTRAST (the other dry worlds): ember_steppe is grey ash + basalt (fire), mistral an
// ochre highland (wind). Sunspire is GOLD — bright bleached rock, saturated dunes, glare — and it keeps
// exactly one water feature: the rare pour-point oasis pond (the mirage/true-oasis game).
//
// ─── ARCHITECTURE (the S-25 fan-out pattern; ember_steppe = the dry-world sibling) ─────────────────────
// A SPLINE-BASE world (massif OFF): the region layer's terrain knobs are LIVE on the spline path (S-25+
// region-driven terrain — column_gen.raw_land_no_cirque; owner: every world uses the realism tech). Regions
// PIN the BIOME and SHAPE terrain per zone (relief/height_bias/roughness on the classes below); the base TERRAIN comes from
// the dune splines (long smooth weirdness crests = dune lines), the mesa-belt erosion curve, the light
// canyon stage (mesa ravines) and slope-gated strata (the banded mesa walls).
//
// HYDROLOGY: sea dropped BELOW the land (the ember idiom) + rivers killed ⇒ bone dry; lakes are NOT
// killed but made RARE (threshold 0.86) ⇒ the few pour-point ponds that survive ARE the true oases —
// the tropical `verdant_oasis` pin + palms + clear water optics dress them.
//
// DECORATION-KEY LAW (surface_decorator.js:491): `structure_pool_overrides` + `tree_species` keys are
// REGISTRY names (the paradise idiom); evocative names ride the region CLASSES.

import { DEFAULT_WORLD_GEN_CONFIG } from '../world_gen_config.js'

/** @typedef {import('../world_gen_config.js').WorldGenConfig & { name: string, biome_pin: string }} NamedWorldConfig */

/**
 * Builds the sunspire-dunes recipe: a deep clone of the live DEFAULT (inherits every field this lane
 * does not tune, so it tracks the schema) + the golden-desert overrides + the world identity metadata.
 * @returns {NamedWorldConfig}
 */
function build_sunspire_dunes() {
  const base = /** @type {NamedWorldConfig} */ (structuredClone(DEFAULT_WORLD_GEN_CONFIG))

  base.name = 'sunspire_dunes'
  base.biome_pin = 'glass_desert'
  base.seed = 'sunspire-mirage' // probed for the region-field percentiles below (a local probe script)
  base.version = 1 // sunspire-dunes recipe lineage v1 (config_hash differs from DEFAULT + every sibling)

  // --- CLIMATE FIELD FREQUENCIES (noise) ---------------------------------------------------------
  // erosion LONG ⇒ broad dune basins alternate with mesa belts; weirdness LONG + fewer octaves ⇒ the
  // PV folds run as long smooth DUNE-CREST lines, not a bump field.
  base.noise = {
    ...base.noise,
    erosion: { period: 1600, octaves: 6, spread: 2, gain: 0.5 }, // (was 1024) broad basins vs mesa belts
    weirdness: { period: 700, octaves: 3, spread: 2, gain: 0.5 }, // (was 512/o4) long dune-crest lines
  }

  // --- TERRAIN SHAPING SPLINES (the dune sea + mesa belts) ----------------------------------------
  base.splines = {
    // A high dry floor: everything sits far above the dropped sea (8) — no coast, no shelf. Gentle
    // rise from 126 to a 162 inland back.
    continentalness_to_base: [
      [0.0, 126],
      [0.25, 134],
      [0.5, 142],
      [0.75, 150],
      [1.0, 162],
    ],
    // Mesa amplitude at low erosion (banded walls via strata + canyon), rolling dune swell at high.
    // Peak math: 162 + 96 = 258 ≪ the 382 cap.
    erosion_to_amplitude: [
      [0.0, 96],
      [0.3, 60],
      [0.55, 26],
      [0.8, 14],
      [1.0, 7],
    ],
    // Dune-crest curve: soft swell across the low/mid range (walkable dune lines), a late hard ramp —
    // the sunspire towers standing off the flats.
    pv_to_relief: [
      [0.0, -0.12],
      [0.3, 0.0],
      [0.6, 0.18],
      [0.8, 0.5],
      [0.92, 0.8],
      [1.0, 1.0],
    ],
  }

  // --- HYDROLOGY (bone dry + the RARE TRUE OASIS) -------------------------------------------------
  base.hydrology = {
    ...base.hydrology,
    sea_level: 8, // dropped far below the floor ⇒ zero ambient flooding (the ember idiom)
    river: { ...base.hydrology.river, continentalness_min: 1.0 }, // cont < 1 always ⇒ no channels
    lake: {
      ...base.hydrology.lake,
      period: 300,
      threshold: 0.86, // (was 0.72) RARE — only the deepest basin cores qualify: the true oases
      erosion_min: 0.5,
      pv_max: 0.35,
      min_body_depth: 2, // a shallow desert pond survives the puddle gate
    },
  }

  // --- 3D DENSITY / OVERHANG GATE (wind-carved sunspires) -----------------------------------------
  base.density = {
    ...base.density,
    warp: { period: 300, octaves: 2, amp: 18 }, // smooth wind-worn faces
    detail: { period: 150, octaves: 4, amp: 24 }, // soft carved detail
    // Gate opens only on the spire columns ⇒ wind-mushroomed hoodoo caps; dunes stay smooth.
    overhang: { erosion_max: 0.4, pv_min: 0.6, strength: 1.4 },
  }

  // --- CANYON STAGE (mesa ravines) ----------------------------------------------------------------
  base.carvers = { ...base.carvers, canyon: { enabled: true, width: 0.05, depth: 34, wall_steepness: 2.2, warp: true } }

  // --- STRATA BANDING (the banded mesa walls) -----------------------------------------------------
  base.strata = {
    ...base.strata,
    enabled: true,
    band_height: 6,
    band_jitter: 3,
    slope_gate: 1.2, // steep mesa/canyon walls only
    palette: ['sand', 'stone', 'dirt'], // golden band / bleached rock / terracotta seam
  }

  // --- WATER OPTICS (the true oasis — small, clear, precious) -------------------------------------
  base.water = {
    body_color: [0.03, 0.1, 0.12], // clear cool pool
    shallow_color: [0.2, 0.5, 0.5], // inviting green-blue margin
    sigma: [0.8, 0.35, 0.3], // high clarity
    fade_start: 3.5,
    tint_depth: 9.0,
    deep_floor: 0.15,
  }

  // --- TEXTURE IDENTITY (the GOLD / GLARE palette) ------------------------------------------------
  // Per-family HSV recolor of the shared atlas (baked copy + LOD far-shell): saturated golden dunes,
  // sun-bleached gold rock (the near-grey stone needs sat UP — the everest idiom), terracotta seams,
  // dry sage scrub, olive palm canopy, bleached timber.
  base.textures = {
    families: {
      sand: { hue: 6, sat: 1.25, val: 1.1 }, // golden dune sand
      stone: { hue: 25, sat: 1.15, val: 1.02 }, // sun-bleached gold rock
      dirt: { hue: -2, sat: 1.2, val: 0.75 }, // terracotta seam
      grass: { hue: -12, sat: 0.7, val: 0.9 }, // dry sage scrub
      foliage: { hue: -10, sat: 0.85, val: 0.95 }, // olive palm canopy
      wood: { hue: 5, sat: 0.75, val: 0.95 }, // bleached timber
    },
  }

  // --- SKY ISLANDS OFF (the mirage is on the ground) ----------------------------------------------
  base.sky = { ...base.sky, enabled: false }

  // --- BIOME SELECTION: heat bias + pin-only members gated out ------------------------------------
  // The cinderforge-proven pair: a placement-only heat bias + the desert point ON the field mass
  // (h 0.42 / pv 0.12) with a weight lead ⇒ the dune fabric wins the no-pin band; grassland keeps the
  // wetter/flatter scrub patches and scorched the low-erosion mesa belts. tropical/obsidian_spires/
  // alpine place ONLY via region pins.
  base.biome_selection = {
    ...base.biome_selection,
    climate_bias: { temperature: 0.3 },
    weirdness_esoteric_threshold: 1.0,
  }

  // --- S-25 SUB-BIOME REGION LAYER (world-as-planet) — six desert sub-biomes -----------------------
  // Terrain knobs LIVE on the classes (S-25+ region-driven terrain). Band edges at the MEASURED field
  // percentiles (probed locally, seed sunspire-mirage: p13=0.268 p26=0.348 p66=0.595
  // p78=0.672 p88=0.734) — area split ≈ 13/13/40/12/10/13, the no-pin dune sea widest, the verdant
  // oasis the rare treasure. blend 0.05 cross-fades borders. Pins name REGISTRY biomes.
  base.regions = {
    enabled: true,
    field: { period: 2000, octaves: 2 }, // vast regions — a dune sea takes a while to cross
    warp: { period: 1000, octaves: 2, amp: 360 }, // organic band pockets
    blend: 0.05,
    variance: { period: 260, octaves: 2 },
    // TERRAIN KNOBS (S-25+ region-driven terrain): the dune sea rolls, the mesas stand flat-topped and broken,
    // the glass flats lie dead-flat, the oasis sinks into a wind-scoured hollow, and the karst towers rise
    // dramatic — real desert morphology from one field. dunes get LOW roughness (smooth-rolling), rock country
    // HIGH roughness (broken edges). height_bias sits mesas/karst up and the oasis down.
    classes: [
      {
        name: 'scrub_fringe',
        upto: 0.268,
        biome: 'grassland',
        relief_scale: 0.7,
        height_bias: 0,
        roughness_scale: 0.8,
      }, // gentle dry acacia scrub steppe (~13%)
      {
        name: 'mirage_mesa',
        upto: 0.348,
        biome: 'scorched_badlands',
        relief_scale: 1.2,
        height_bias: 8,
        roughness_scale: 1.3,
      }, // flat-topped raised red-rock mesas (~13%)
      { name: 'dune_sea', upto: 0.595, relief_scale: 0.9, height_bias: 0, roughness_scale: 0.7 }, // NO PIN — dominant (~40%), smooth-rolling golden dunes (identity)
      {
        name: 'glass_flats',
        upto: 0.672,
        biome: 'obsidian_spires',
        relief_scale: 0.2,
        height_bias: -2,
        roughness_scale: 0.3,
      }, // dead-flat sun-fused glass pavement (~12%)
      {
        name: 'verdant_oasis',
        upto: 0.734,
        biome: 'tropical',
        relief_scale: 0.5,
        height_bias: -6,
        roughness_scale: 0.6,
      }, // sunken wind-scoured palm hollow (~10%)
      { name: 'sunspire_karst', upto: 1.01, biome: 'alpine', relief_scale: 1.7, height_bias: 6, roughness_scale: 1.6 }, // dramatic wind-carved gold towers (~13%)
    ],
  }

  // --- STRUCTURE POOL OVERRIDES (REGISTRY-name keys) ----------------------------------------------
  // Cacti + desert trees scatter the dunes; sandstone slabs band the mesas and spires; acacia
  // schematics crowd the scrub; palms + undergrowth dress the oasis; glass flats get volcanic
  // (lava-glint = sun-glint) shards. obsidian_spires/alpine have no base row ⇒ override-only.
  base.structure_pool_overrides = {
    desert: ['pool_desert_flora'],
    grassland: ['pool_savanna_trees', 'pool_rocks_sandstone'],
    scorched_badlands: ['pool_rocks_sandstone'],
    obsidian_spires: ['pool_rocks_volcanic'],
    tropical: ['pool_palms', 'pool_tropical_undergrowth'],
    alpine: ['pool_rocks_sandstone'],
  }

  // --- TREE SPECIES (REGISTRY-name keys) ----------------------------------------------------------
  // Flat-top acacia is the horizon silhouette; the oasis is palm country; the spires are bare.
  base.tree_species = {
    ...base.tree_species,
    desert: [
      { species: 'acacia_umbrella', weight: 2 },
      { species: 'dead_snag', weight: 1 },
    ],
    grassland: [
      { species: 'acacia_umbrella', weight: 3 },
      { species: 'dead_snag', weight: 1 },
    ],
    tropical: [
      { species: 'palm_curve', weight: 3 },
      { species: 'jungle_giant', weight: 1 },
    ],
    alpine: [],
  }

  // --- DECORATION (sparse, sun-blasted) -----------------------------------------------------------
  base.decoration = {
    ...base.decoration,
    tree_grove_one_in: 8, // (DEFAULT 3) lonely acacia stands
    rock_grove_one_in: 5, // (DEFAULT 6) a bit more rock — hoodoo rubble is the texture
    flower_patch_one_in: 18, // near-zero bloom outside the oasis
    // Dry-land accents only: scrub bush, dead branches, pebbles (grassland accents on the fringe).
    sprites: { fern: false, flower: false, bush: true, dead_branch: true, pebbles: true },
  }

  // --- BIOME TABLE: REGISTRY names/ids. UNGATED fabric = desert/grassland/scorched_badlands (the
  // no-pin dune-sea mosaic — dunes, scrub patches, mesa belts); GATED pin-only = tropical/
  // obsidian_spires/alpine. NO ocean/river/beach members — a landlocked glare world. ----------------
  base.biomes = [
    {
      id: 10,
      name: 'desert',
      // ON the field mass (the cinderforge fabric formula: h 0.42 / pv 0.12 / ero 0.75 + heat bias +
      // weight lead) ⇒ the dune sea IS the fabric.
      climate: { temperature: 0.85, humidity: 0.42, continentalness: 0.55, erosion: 0.75, pv: 0.12 },
      weight: 1.5,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'sand', underwater: 'sand', filler: 'stone' },
      tree_density: 0.008,
      grass_density: 0.04,
      structure_pools: ['pool_desert_flora'],
      music_bed: 'desert',
    }, // the golden dune sea
    {
      id: 3,
      name: 'grassland',
      climate: { temperature: 0.7, humidity: 0.55, continentalness: 0.6, erosion: 0.85, pv: 0.3 },
      weight: 1.0,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.03,
      grass_density: 0.4,
      structure_pools: ['pool_savanna_trees', 'pool_rocks_sandstone'],
      music_bed: 'grassland',
    }, // dry acacia scrub — the fringe + the wetter fabric patches
    {
      id: 11,
      name: 'scorched_badlands',
      climate: { temperature: 0.9, humidity: 0.3, continentalness: 0.62, erosion: 0.35, pv: 0.5 },
      weight: 1.05,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'dirt', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0.02,
      structure_pools: ['pool_rocks_sandstone'],
      music_bed: 'desert',
    }, // red-rock mesa belts (banded by strata + cut by the canyon stage)
    // PIN-ONLY members (weirdness_gate:true ⇒ region pins only).
    {
      id: 12,
      name: 'tropical',
      climate: { temperature: 0.8, humidity: 0.85, continentalness: 0.6, erosion: 0.75, pv: 0.3 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.14,
      grass_density: 0.7,
      structure_pools: ['pool_palms', 'pool_tropical_undergrowth'],
      music_bed: 'tropical',
    }, // verdant_oasis — dense palms + green ground (the Ensable Cavern hides under one)
    {
      id: 15,
      name: 'obsidian_spires',
      climate: { temperature: 0.85, humidity: 0.15, continentalness: 0.74, erosion: 0.2, pv: 0.8 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: ['pool_rocks_volcanic'],
      music_bed: 'esoteric',
    }, // glass_flats — sun-fused pavement, glinting shards
    {
      id: 13,
      name: 'alpine',
      climate: { temperature: 0.7, humidity: 0.2, continentalness: 0.72, erosion: 0.15, pv: 0.88 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0.02,
      structure_pools: ['pool_rocks_sandstone'],
      music_bed: 'alpine',
    }, // sunspire_karst — bare gold hoodoo towers
  ]

  return base
}

/** The SUNSPIRE DUNES world recipe (world 10) — pass to `create_engine({ world_config })`. */
export const SUNSPIRE_DUNES_WORLD = build_sunspire_dunes()
