// WORLD 12 · STATIC FIELDS (on-chain `12_static_fields`, biome `storm_plateau`) — the storm-plateau
// planet. Seed identity (seed/mainnet/12_static_fields/world.json): air+fire elements, "static charge —
// storm cells roll the plateau; metal gear hums before every strike", "thunder-herd country — rex packs
// graze under rolling storm cells; the +1 range helm chase". The engine identity: a VAST HIGH GRAZING
// PLATEAU under storm light — wind-rippled sage plains (the herd country), slate-purple storm rock,
// stormwater gullies and tarns, wind-bent conifer squall belts, bare thunder shelves, dark sodden moors
// — and the fulgurite scars: lightning-fused glass fields where the strikes land.
//
// ─── ARCHITECTURE (the S-25 fan-out pattern; mistral_heights = the highland sibling, re-tuned FLATTER) ─
// A CLASSIC-SPLINE world (massif OFF): the region layer's terrain knobs WERE inert pre-2026-07-13 — now LIVE on the spline path (S-25+ region-driven terrain, column_gen.raw_land_no_cirque; see TERRAIN KNOBS on the classes) (the classes below carry them). The region layer PINS the BIOME per column; the plateau
// TERRAIN comes from a high flat base curve + low amplitude (big sky, long sightlines — herd country),
// a light canyon stage (storm gullies) and slope-banded shelf edges.
//
// DECORATION-KEY LAW (surface_decorator.js:491): `structure_pool_overrides` + `tree_species` keys are
// REGISTRY names (the paradise idiom); evocative names ride the region CLASSES.

import { DEFAULT_WORLD_GEN_CONFIG } from '../world_gen_config.js'

/** @typedef {import('../world_gen_config.js').WorldGenConfig & { name: string, biome_pin: string }} NamedWorldConfig */

/**
 * Builds the static-fields recipe: a deep clone of the live DEFAULT (inherits every field this lane
 * does not tune, so it tracks the schema) + the storm-plateau overrides + the world identity metadata.
 * @returns {NamedWorldConfig}
 */
function build_static_fields() {
  const base = /** @type {NamedWorldConfig} */ (structuredClone(DEFAULT_WORLD_GEN_CONFIG))

  base.name = 'static_fields'
  base.biome_pin = 'storm_plateau'
  base.seed = 'static-thunder-herd' // probed for the region-field percentiles below (a local probe script)
  base.version = 1 // static-fields recipe lineage v1 (config_hash differs from DEFAULT + every sibling)

  // --- CLIMATE FIELD FREQUENCIES (noise) ---------------------------------------------------------
  // Both LONG ⇒ broad plateau basins + soft long swells: the plains must read VAST (rex-herd
  // sightlines), never busy.
  base.noise = {
    ...base.noise,
    erosion: { period: 1700, octaves: 6, spread: 2, gain: 0.5 }, // (was 1024) broad shelf belts vs plains
    weirdness: { period: 850, octaves: 3, spread: 2, gain: 0.5 }, // (was 512/o4) long soft swells
  }

  // --- TERRAIN SHAPING SPLINES (the high grazing plateau) -----------------------------------------
  base.splines = {
    // HIGH INLAND: the whole curve sits well above the waterline (134 ≥ 128+6) — no ocean; only the
    // pv gully-dip below can pond (storm tarns). A gentle rise to a 172 plateau back.
    continentalness_to_base: [
      [0.0, 134],
      [0.25, 146],
      [0.5, 155],
      [0.75, 163],
      [1.0, 172],
    ],
    // Mostly FLAT: modest shelf edges at low erosion, wide open plains at high. Peak math: 172 + 70 =
    // 242 ≪ the 382 cap.
    erosion_to_amplitude: [
      [0.0, 70],
      [0.3, 36],
      [0.6, 14],
      [0.8, 8],
      [1.0, 6],
    ],
    // Gully dips to shelf rises: a real negative dip (storm tarns pool in the gullies), long flat
    // shoulders, a late ramp to the thunder shelves.
    pv_to_relief: [
      [0.0, -0.2],
      [0.3, 0.0],
      [0.6, 0.15],
      [0.85, 0.55],
      [1.0, 1.0],
    ],
  }

  // --- 3D DENSITY / OVERHANG GATE (crag lips on the shelf edges only) -----------------------------
  base.density = {
    ...base.density,
    warp: { period: 260, octaves: 2, amp: 18 }, // wind-smoothed faces
    detail: { period: 140, octaves: 4, amp: 22 }, // storm-notched shelf detail
    // Gate opens only on the rare low-erosion + high-pv shelf crowns; the plains stay clean.
    overhang: { erosion_max: 0.35, pv_min: 0.7, strength: 1.0 },
  }

  // --- CANYON STAGE (storm gullies) ---------------------------------------------------------------
  // A light additive carve: flash-flood gullies threading the plateau (drainage for the storm cells).
  base.carvers = {
    ...base.carvers,
    canyon: { enabled: true, width: 0.045, depth: 26, wall_steepness: 2.0, warp: true },
  }

  // --- STRATA BANDING (banded shelf walls) --------------------------------------------------------
  base.strata = {
    ...base.strata,
    enabled: true,
    band_height: 6,
    band_jitter: 3,
    slope_gate: 1.3, // steep shelf/gully walls only
    palette: ['stone', 'dirt', 'stone'], // slate bands with a dark seam
  }

  // --- HYDROLOGY (stormwater gullies + tarns) -----------------------------------------------------
  base.hydrology = {
    ...base.hydrology,
    river: {
      ...base.hydrology.river,
      width: 0.16, // slightly broad storm runs
      depth: 8,
      bank: 2,
    },
    lake: {
      ...base.hydrology.lake,
      period: 280,
      threshold: 0.66, // more of the flats pond — storm tarns
      erosion_min: 0.45,
      pv_max: 0.4,
      min_body_depth: 2,
    },
  }

  // --- WATER OPTICS (steel stormwater) ------------------------------------------------------------
  base.water = {
    body_color: [0.035, 0.045, 0.06], // dark steel-blue
    shallow_color: [0.16, 0.2, 0.24], // slate margin
    sigma: [1.2, 1.0, 0.85], // murky, blue survives longest
    fade_start: 1.4,
    tint_depth: 4.0,
    deep_floor: 0.14,
  }

  // --- TEXTURE IDENTITY (the STORM-SLATE palette) -------------------------------------------------
  // Per-family HSV recolor of the shared atlas (baked copy + LOD far-shell). The hero move: STONE →
  // slate-PURPLE storm rock (sat up on the near-grey base — the everest idiom); sage-grey grass reads
  // as wind-flattened steppe under storm light.
  base.textures = {
    families: {
      stone: { hue: 250, sat: 1.5, val: 0.78 }, // slate-purple storm rock
      grass: { hue: 8, sat: 0.65, val: 0.82 }, // storm-sage plains
      foliage: { hue: 6, sat: 0.6, val: 0.72 }, // dark wind-bent canopy
      dirt: { sat: 0.8, val: 0.6 }, // dark storm loam
      sand: { sat: 0.4, val: 0.75 }, // grey gully silt
      wood: { sat: 0.7, val: 0.6 }, // storm-grey timber
      water: { sat: 0.6, val: 0.8 }, // steel water texture
    },
  }

  // --- SKY ISLANDS OFF (the sky belongs to the storm cells) ---------------------------------------
  base.sky = { ...base.sky, enabled: false }

  // --- BIOME SELECTION: pin-only members gated out of climate placement ---------------------------
  // No bias: grassland's point sits ON the field means with a weight lead (the proven fabric formula)
  // ⇒ the herd plains ARE the fabric; river keeps the pv-fold gullies. taiga/alpine/obsidian_spires/
  // void_marsh place ONLY via region pins.
  base.biome_selection = {
    ...base.biome_selection,
    weirdness_esoteric_threshold: 1.0,
  }

  // --- S-25 SUB-BIOME REGION LAYER (world-as-planet) — six storm sub-biomes ------------------------
  // Terrain knobs LIVE on the classes (S-25+ region-driven terrain). Band edges at the MEASURED field
  // percentiles (probed locally, seed static-thunder-herd: p13=0.287 p26=0.379 p66=0.578
  // p78=0.630 p88=0.692) — area split ≈ 13/13/40/12/10/13, the no-pin herd plains widest, the
  // fulgurite scars the rare strike-ground. blend 0.05 cross-fades borders. Pins name REGISTRY biomes.
  base.regions = {
    enabled: true,
    field: { period: 1900, octaves: 2 }, // vast regions — plateau country runs long
    warp: { period: 950, octaves: 2, amp: 350 }, // organic band pockets
    blend: 0.05,
    variance: { period: 250, octaves: 2 },
    // TERRAIN KNOBS (S-25+ region-driven terrain, own settings): storm-plateau morphology — rain basins
    // cut stormwater gullies and tarns, the thunder shelf stands RAISED bare and smooth-scoured, the
    // fulgurite fields lie flat glass, the sodden moor dips dark. The herd plains keep the recipe's roll.
    classes: [
      { name: 'squall_thicket', upto: 0.287, biome: 'taiga', relief_scale: 0.9, height_bias: 2, roughness_scale: 1.0 }, // wind-bent conifer belts (~13%)
      { name: 'rain_basin', upto: 0.379, biome: 'river', relief_scale: 0.5, height_bias: -4, roughness_scale: 0.7 }, // stormwater gully + tarn country (~13%)
      { name: 'herd_plains', upto: 0.578 }, // NO PIN — dominant (~40%), the grazing-plateau fabric (identity)
      { name: 'thunder_shelf', upto: 0.63, biome: 'alpine', relief_scale: 1.2, height_bias: 8, roughness_scale: 0.7 }, // RAISED bare storm-scoured shelf, smooth top (~12%)
      {
        name: 'fulgurite_scar',
        upto: 0.692,
        biome: 'obsidian_spires',
        relief_scale: 0.3,
        height_bias: -1,
        roughness_scale: 0.4,
      }, // flat lightning-glass fields (~10%)
      {
        name: 'storm_moor',
        upto: 1.01,
        biome: 'void_marsh',
        relief_scale: 0.45,
        height_bias: -2,
        roughness_scale: 0.6,
      }, // dark sodden moor dips (~13%)
    ],
  }

  // --- STRUCTURE POOL OVERRIDES (REGISTRY-name keys) ----------------------------------------------
  // Granite erratics dot the plains (herd-country furniture); conifer schematics back the squall
  // belts; the shelves get alpine boulders; the scars glinting glass (volcanic pool); the moor dead
  // tangle + mounds. obsidian_spires/void_marsh/alpine ride override/base-row densities.
  base.structure_pool_overrides = {
    grassland: ['pool_rocks_granite'],
    taiga: ['pool_conifers'],
    alpine: ['pool_rocks_alpine', 'pool_rocks_granite'],
    obsidian_spires: ['pool_rocks_volcanic'],
    void_marsh: ['pool_dead_trees', 'pool_mud_mounds'],
  }

  // --- TREE SPECIES (REGISTRY-name keys; wind-shaped rosters) -------------------------------------
  // The plains grow lone wind-bent oaks + snags; the squall belts drop the cathedral pines for LOW
  // wind-bent spruce (a storm plateau grows no towers); the shelves are bare.
  base.tree_species = {
    ...base.tree_species,
    grassland: [
      { species: 'oak_broadleaf', weight: 2 },
      { species: 'dead_snag', weight: 1 },
    ],
    taiga: [
      { species: 'spruce_mid', weight: 3 },
      { species: 'pine_cathedral', weight: 1 },
    ],
    alpine: [],
  }

  // --- DECORATION (wind-rippled open steppe) ------------------------------------------------------
  base.decoration = {
    ...base.decoration,
    tree_grove_one_in: 6, // (DEFAULT 3) lone stands — open herd country
    tall_cluster_one_in: 3, // (DEFAULT 5) MORE wind-rippled tall-grass patches (the steppe texture)
    flower_patch_one_in: 10, // sparse bloom under storm light
    // Storm-steppe accents: bush/branches/pebbles on the plains, lichen on the bare shelves.
    sprites: { fern: false, bush: true, dead_branch: true, pebbles: true, lichen: true },
  }

  // --- BIOME TABLE: REGISTRY names/ids. UNGATED fabric = grassland/river (the no-pin herd-plains
  // mosaic — plains + stormwater gullies); GATED pin-only = taiga/alpine/obsidian_spires/void_marsh.
  // NO ocean/beach — a high plateau (low ground ponds into tarns). -----------------------------------
  base.biomes = [
    {
      id: 3,
      name: 'grassland',
      // ON the field means + a weight lead (the proven fabric formula) ⇒ the plains ARE the fabric.
      climate: { temperature: 0.5, humidity: 0.5, continentalness: 0.6, erosion: 0.7, pv: 0.1 },
      weight: 1.5,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.02,
      grass_density: 0.9,
      structure_pools: ['pool_rocks_granite'],
      music_bed: 'grassland',
    }, // the herd plains — wind-rippled sage steppe
    {
      id: 2,
      name: 'river',
      climate: { temperature: 0.5, humidity: 0.65, continentalness: 0.5, erosion: 0.7, pv: 0.02 },
      weight: 1.0,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
      tree_density: 0.05,
      grass_density: 0.6,
      structure_pools: [],
      music_bed: 'river',
    }, // stormwater runs + the rain_basin pin — grassy gully banks
    // PIN-ONLY members (weirdness_gate:true ⇒ region pins only).
    {
      id: 7,
      name: 'taiga',
      climate: { temperature: 0.35, humidity: 0.5, continentalness: 0.68, erosion: 0.6, pv: 0.5 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.16,
      grass_density: 0.3,
      structure_pools: ['pool_conifers'],
      music_bed: 'taiga',
    }, // squall_thicket — low wind-bent conifer belts
    {
      id: 13,
      name: 'alpine',
      climate: { temperature: 0.35, humidity: 0.4, continentalness: 0.72, erosion: 0.15, pv: 0.85 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0.06,
      structure_pools: ['pool_rocks_alpine', 'pool_rocks_granite'],
      music_bed: 'alpine',
    }, // thunder_shelf — bare slate shelves, lichen in the cracks
    {
      id: 15,
      name: 'obsidian_spires',
      climate: { temperature: 0.6, humidity: 0.3, continentalness: 0.74, erosion: 0.2, pv: 0.8 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: ['pool_rocks_volcanic'],
      music_bed: 'esoteric',
    }, // fulgurite_scar — lightning-fused glass ground
    {
      id: 16,
      name: 'void_marsh',
      climate: { temperature: 0.4, humidity: 0.9, continentalness: 0.55, erosion: 0.9, pv: 0.25 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'dirt', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.03,
      grass_density: 0.15,
      structure_pools: ['pool_dead_trees', 'pool_mud_mounds'],
      music_bed: 'esoteric',
    }, // storm_moor — dark sodden ground under the permanent cell
  ]

  return base
}

/** The STATIC FIELDS world recipe (world 12) — pass to `create_engine({ world_config })`. */
export const STATIC_FIELDS_WORLD = build_static_fields()
