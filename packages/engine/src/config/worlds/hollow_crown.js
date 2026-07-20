// WORLD 19 · HOLLOW CROWN (on-chain `19_hollow_crown`, biome `celestial_ruin`) — the dead-god highland
// planet. Seed identity (seed/mainnet/19_hollow_crown/world.json): air+fire elements, "the hollow crown
// — the dead god's halo bends light; auras invert at the maw", the second AP crown, agility lean. The
// engine identity: a BLEACHED GOLD-WHITE CELESTIAL RUIN — long crown ridgelines you walk along (the
// broken ring of the crown), pale seraph meadows, white godbone fields, gilded dust terraces, dark
// inverted MAW spires (the one black accent), aura-bent hollows — and the HALO adrift overhead (sky
// islands ON: the shattered ring still orbits). mistral_heights is the ridgeline prior art; pandora
// the sky-band prior art.
//
// ─── ARCHITECTURE (the S-25 fan-out pattern) ────────────────────────────────────────────────────────────
// A CLASSIC-SPLINE world (massif OFF): the region layer's terrain knobs WERE inert pre-2026-07-13 — now LIVE on the spline path (S-25+ region-driven terrain, column_gen.raw_land_no_cirque; see TERRAIN KNOBS on the classes) (the classes below carry them). The region layer PINS the BIOME per column; the RIDGE identity
// comes from the tuned climate splines (long-period weirdness ⇒ coherent crown ridgelines — the mistral
// lever) and the crest-only overhang gate (wind-carved crown crags).
//
// DECORATION-KEY LAW (surface_decorator.js:491): `structure_pool_overrides` + `tree_species` keys are
// REGISTRY names (the paradise idiom); evocative names ride the region CLASSES. alpine / obsidian_spires
// / crystal_hollows have NO BIOME_SCHEMATICS row ⇒ overrides-only schematics fire (live); arctic's base
// row (ARCTIC_BIG_ROCK) gains pool_ice — white halo-glass shards on the godbone fields.

import { DEFAULT_WORLD_GEN_CONFIG } from '../world_gen_config.js'

/** @typedef {import('../world_gen_config.js').WorldGenConfig & { name: string, biome_pin: string }} NamedWorldConfig */

/**
 * Builds the hollow-crown recipe: a deep clone of the live DEFAULT (inherits every field this lane
 * does not tune, so it tracks the schema) + the celestial-ruin overrides + the world identity metadata.
 * @returns {NamedWorldConfig}
 */
function build_hollow_crown() {
  const base = /** @type {NamedWorldConfig} */ (structuredClone(DEFAULT_WORLD_GEN_CONFIG))

  base.name = 'hollow_crown'
  base.biome_pin = 'celestial_ruin'
  base.seed = 'hollow-crown-halo' // probed for the region-field percentiles below (probe_rdist method)
  base.version = 1 // hollow-crown recipe lineage v1 (config_hash differs from DEFAULT + every sibling)

  // --- CLIMATE FIELD FREQUENCIES (noise) — the terrain-variety source on a spline world ----------
  // weirdness LONG + fewer octaves (the mistral ridgeline lever) ⇒ PV folds into LONG coherent crown
  // ridges — the broken ring; erosion longer ⇒ broad crest belts vs wide meadow basins.
  base.noise = {
    ...base.noise,
    erosion: { period: 1500, octaves: 6, spread: 2, gain: 0.5 }, // (was 1024) broad crest belts vs basins
    weirdness: { period: 950, octaves: 3, spread: 2, gain: 0.5 }, // (was 512/o4) the long crown ring-lines
  }

  // --- TERRAIN SHAPING SPLINES (the high broken ring) ---------------------------------------------
  base.splines = {
    // High inland — the whole curve sits ABOVE the waterline (128); only the deep pv glens pond into
    // rare pale tarns (the mistral idiom). Gentle rise to a 172 crown back.
    continentalness_to_base: [
      [0.0, 131],
      [0.2, 140],
      [0.45, 150],
      [0.7, 160],
      [1.0, 172],
    ],
    // Crown amplitude: tall crests at low erosion stepping down to near-flat seraph meadows.
    // Peak math: 172 + 118 ≈ 290 — the tallest crests brush the halo band's reach (deliberate: the
    // crown almost touches its own broken ring), still ≪ the 382 cap.
    erosion_to_amplitude: [
      [0.0, 118],
      [0.22, 88],
      [0.45, 48],
      [0.7, 22],
      [1.0, 8],
    ],
    // Ridge-walk curve: a shallow glen dip (pale tarns), flat shoulders, then a broad ramp to full
    // crest — ridges you WALK ALONG (the mistral read), not spike fields.
    pv_to_relief: [
      [0.0, -0.12],
      [0.28, 0.0],
      [0.52, 0.2],
      [0.75, 0.55],
      [0.9, 0.85],
      [1.0, 1.0],
    ],
  }

  // --- 3D DENSITY / OVERHANG GATE (wind-carved crown crags on the crests only) --------------------
  base.density = {
    ...base.density,
    warp: { period: 240, octaves: 2, amp: 22 },
    detail: { period: 145, octaves: 4, amp: 26 },
    // Opens only on the low-erosion + high-pv crest columns ⇒ carved crown-stone undercuts.
    overhang: { erosion_max: 0.4, pv_min: 0.55, strength: 1.1 },
  }

  // --- WATER OPTICS (luminous pale tarns — light bends here) --------------------------------------
  base.water = {
    body_color: [0.05, 0.1, 0.12], // pale steel body
    shallow_color: [0.3, 0.34, 0.3], // milk-gold luminous shallows
    sigma: [0.5, 0.42, 0.5], // high clarity, even — white light
    fade_start: 3.5,
    tint_depth: 9.0,
    deep_floor: 0.18,
  }

  // --- TEXTURE IDENTITY (the BLEACHED GOLD-WHITE celestial palette) -------------------------------
  base.textures = {
    families: {
      stone: { hue: 8, sat: 0.7, val: 1.05 }, // pale gilt crown-stone
      sand: { hue: 6, sat: 0.9, val: 1.1 }, // gold dust terraces
      grass: { hue: -14, sat: 0.65, val: 1.05 }, // bleached pale-gold meadow
      foliage: { hue: -12, sat: 0.7, val: 1.0 }, // washed gold canopy
      dirt: { hue: 4, sat: 0.8, val: 0.85 }, // warm pale earth
      wood: { sat: 0.75, val: 0.85 }, // sun-bleached timber
    },
  }

  // --- SKY ISLANDS ON (the HALO — the dead god's broken ring adrift) ------------------------------
  // Island SHAPE params stay DEFAULT (validator: thickness 116 ≥ cap_radius_max·root_ratio_max =
  // 114.4). Band raised a hair over pandora's (292-348: crown crests reach ~290, so the halo hangs
  // JUST above the highest walk — light you can almost touch) with crown + thickness inside the box.
  base.sky = {
    ...base.sky,
    enabled: true,
    region_rate: 0.3, // (was 0.13) most sky regions carry halo fragments
    islands_min: 4, // (was 3)
    islands_max: 9, // (was 8)
    low_y: 292,
    high_y: 348,
  }

  // --- BIOME SELECTION: pin-only members gated out of climate placement ---------------------------
  base.biome_selection = {
    ...base.biome_selection,
    weirdness_esoteric_threshold: 1.0,
  }

  // --- S-25 SUB-BIOME REGION LAYER (world-as-planet) — six celestial sub-biomes -------------------
  // Terrain knobs LIVE on the classes (S-25+ region-driven terrain). Band edges at the MEASURED field
  // percentiles (probe_rdist method, seed hollow-crown-halo: p13=0.302 p25=0.373 p65=0.561 p78=0.637
  // p88=0.695) — area split ≈ 13/12/40/13/10/12, the no-pin crown heights widest, the maw the rare
  // dark inversion. blend 0.05 cross-fades borders. Pins name REGISTRY biomes.
  base.regions = {
    enabled: true,
    field: { period: 1700, octaves: 2 }, // broad celestial reaches (~0.85-1.7 km)
    warp: { period: 850, octaves: 2, amp: 330 }, // organic band pockets
    blend: 0.05,
    variance: { period: 250, octaves: 2 },
    // TERRAIN KNOBS (S-25+ region-driven terrain, own settings): celestial-ruin morphology — the godbone
    // fields lie white and flat, the gold terraces STEP up smooth, seraph courts sit gently raised, the
    // dark maw spires spike rough (the one black accent), the aura hollows sink into bent ruin pockets.
    classes: [
      { name: 'godbone_fields', upto: 0.302, biome: 'arctic', relief_scale: 0.4, height_bias: 1, roughness_scale: 0.4 }, // flat white bone-light fields (~13%)
      { name: 'halo_terrace', upto: 0.373, biome: 'desert', relief_scale: 0.9, height_bias: 6, roughness_scale: 0.5 }, // smooth stepped gold-dust terraces (~12%)
      { name: 'crown_heights', upto: 0.561 }, // NO PIN — dominant (~40%), the ridge/meadow fabric (identity)
      {
        name: 'seraph_meadow',
        upto: 0.637,
        biome: 'grassland',
        relief_scale: 0.55,
        height_bias: 2,
        roughness_scale: 0.6,
      }, // gently raised pale flowering courts (~13%)
      {
        name: 'maw_spires',
        upto: 0.695,
        biome: 'obsidian_spires',
        relief_scale: 1.6,
        height_bias: 8,
        roughness_scale: 1.6,
      }, // the dark inverted maw — rough spikes (~10%)
      {
        name: 'aura_hollow',
        upto: 1.01,
        biome: 'crystal_hollows',
        relief_scale: 0.5,
        height_bias: -5,
        roughness_scale: 0.9,
      }, // sunken aura-bent ruin pockets (~12%)
    ],
  }

  // --- STRUCTURE POOL OVERRIDES (REGISTRY-name keys) ----------------------------------------------
  // arctic gains pool_ice — white halo-glass shards fallen on the godbone fields; alpine crests get
  // granite/alpine boulders (broken crown masonry); the maw gets volcanic black; the aura hollows
  // pale granite ruin-stones; the meadows lonely erratics.
  base.structure_pool_overrides = {
    arctic: ['pool_ice'],
    alpine: ['pool_rocks_alpine', 'pool_rocks_granite'],
    obsidian_spires: ['pool_rocks_volcanic'],
    crystal_hollows: ['pool_rocks_granite'],
    desert: ['pool_rocks_sandstone'],
    grassland: ['pool_rocks_granite'],
  }

  // --- TREE SPECIES (REGISTRY-name keys — bleached, sparse, upright) ------------------------------
  // The meadows grow pale mixed groves (birch reads bleached); the heights weathered snags; the
  // godbone fields + terraces lonely bleached snags. The maw + aura pockets stay bare (no rosters).
  base.tree_species = {
    ...base.tree_species,
    grassland: [
      { species: 'oak_broadleaf', weight: 2 },
      { species: 'birch_slim', weight: 2 },
    ],
    alpine: [{ species: 'dead_snag', weight: 1 }],
    arctic: [{ species: 'dead_snag', weight: 1 }],
    desert: [{ species: 'dead_snag', weight: 1 }],
  }

  // --- DECORATION (open, wind-scoured, quietly gilded) --------------------------------------------
  base.decoration = {
    ...base.decoration,
    tree_grove_one_in: 5, // (DEFAULT 3) open windswept courts
    rock_grove_one_in: 5, // (DEFAULT 6) ruin-stone scatter
    // Highland accents: alpine flowers + lichen on the heights, pebbles + dead branches in the ruins.
    // No forest fern carpet (not a woodland).
    sprites: {
      fern: false,
      alpine_flower: true,
      lichen: true,
      pebbles: true,
      dead_branch: true,
      bush: true,
    },
  }

  // --- BIOME TABLE: REGISTRY names/ids. UNGATED fabric = river/grassland/alpine (the no-pin highland
  // mosaic — streams/meadows/crests); GATED pin-only = arctic/desert/obsidian_spires/crystal_hollows.
  // NO ocean/beach — a high inland ring (low ground ponds into tarns).
  base.biomes = [
    {
      id: 2,
      name: 'river',
      climate: { temperature: 0.5, humidity: 0.7, continentalness: 0.55, erosion: 0.7, pv: 0.02 },
      weight: 1.2,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
      tree_density: 0.05,
      grass_density: 0.5,
      structure_pools: [],
      music_bed: 'river',
    }, // pale highland streams
    {
      id: 3,
      name: 'grassland',
      climate: { temperature: 0.55, humidity: 0.35, continentalness: 0.7, erosion: 0.8, pv: 0.5 },
      weight: 1.2,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.03,
      grass_density: 0.8,
      structure_pools: ['pool_rocks_granite'],
      music_bed: 'grassland',
    }, // the seraph meadow fabric
    {
      id: 13,
      name: 'alpine',
      climate: { temperature: 0.35, humidity: 0.4, continentalness: 0.72, erosion: 0.15, pv: 0.85 },
      weight: 1.05,
      weirdness_gate: false,
      land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0.01,
      grass_density: 0.1,
      structure_pools: ['pool_rocks_alpine'],
      music_bed: 'alpine',
    }, // the crown crests + ring walls
    // PIN-ONLY members (weirdness_gate:true ⇒ region pins only).
    {
      id: 8,
      name: 'arctic',
      climate: { temperature: 0.1, humidity: 0.6, continentalness: 0.68, erosion: 0.7, pv: 0.5 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'snow', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.01,
      grass_density: 0.05,
      structure_pools: ['pool_ice'],
      music_bed: 'esoteric',
    }, // godbone_fields — white bone-light ground
    {
      id: 10,
      name: 'desert',
      climate: { temperature: 0.75, humidity: 0.2, continentalness: 0.72, erosion: 0.82, pv: 0.5 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'sand', subsurface: 'sand', underwater: 'stone', filler: 'stone' },
      tree_density: 0.005,
      grass_density: 0.05,
      structure_pools: ['pool_rocks_sandstone'],
      music_bed: 'desert',
    }, // halo_terrace — gold-dust tablelands
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
    }, // maw_spires — the dark inversion at the maw
    {
      id: 14,
      name: 'crystal_hollows',
      climate: { temperature: 0.5, humidity: 0.5, continentalness: 0.75, erosion: 0.5, pv: 0.6 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.02,
      grass_density: 0.4,
      structure_pools: ['pool_rocks_granite'],
      music_bed: 'esoteric',
    }, // aura_hollow — where the light bends wrong
  ]

  return base
}

/** The HOLLOW CROWN world recipe (world 19) — pass to `create_engine({ world_config })`. */
export const HOLLOW_CROWN_WORLD = build_hollow_crown()
