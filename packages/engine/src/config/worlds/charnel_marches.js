// WORLD 14 · CHARNEL MARCHES (on-chain `14_charnel_marches`, biome `ashen_marsh`) — the war-graves
// marsh planet. Seed identity (seed/mainnet/14_charnel_marches/world.json): fire+earth elements,
// "war-barrow wights — the graves open at dusk; the marches remember their war", drop-income valley,
// vitality lean. The engine identity: a bone-pale ASHEN WAR-MARSH hugging the waterline — grey mud
// flats scarred by flooded trench channels and crater pools, blackened snag woods standing dead,
// pale bone-sand flats, still grave-pools, and low barrow moors. drowned_fen (world 05) is the
// direct prior art: every wetland lever here is fen-proven, re-tuned ASH-GREY (milky corpse-water,
// bone/ash palette) instead of tea-black.
//
// ─── ARCHITECTURE (the S-25 fan-out pattern) ────────────────────────────────────────────────────────────
// A CLASSIC-SPLINE world (massif OFF): the region layer's terrain knobs WERE inert pre-2026-07-13 — now LIVE on the spline path (S-25+ region-driven terrain, column_gen.raw_land_no_cirque; see TERRAIN KNOBS on the classes) (the classes below carry them). The region layer PINS the BIOME per column; the marsh TERRAIN mosaic
// (trenches/craters/barrow rises) comes from the near-waterline splines + the hydrology recipe.
//
// DECORATION-KEY LAW (surface_decorator.js:491): the decorator resolves the column biome via the MODULE
// registry, so `structure_pool_overrides` + `tree_species` keys are REGISTRY names (the paradise idiom);
// evocative names live on the region CLASSES. void_marsh has no BIOME_SCHEMATICS row ⇒ overrides-only
// dead-tree/mud-mound schematics fire at the fallback density (the fen black_pool path, live).

import { DEFAULT_WORLD_GEN_CONFIG } from '../world_gen_config.js'

/** @typedef {import('../world_gen_config.js').WorldGenConfig & { name: string, biome_pin: string }} NamedWorldConfig */

/**
 * Builds the charnel-marches recipe: a deep clone of the live DEFAULT (inherits every field this lane
 * does not tune, so it tracks the schema) + the war-marsh overrides + the world identity metadata.
 * @returns {NamedWorldConfig}
 */
function build_charnel_marches() {
  const base = /** @type {NamedWorldConfig} */ (structuredClone(DEFAULT_WORLD_GEN_CONFIG))

  base.name = 'charnel_marches'
  base.biome_pin = 'ashen_marsh'
  base.seed = 'charnel-war-barrow' // probed for the region-field percentiles below (probe_rdist method)
  base.version = 1 // charnel-marches recipe lineage v1 (config_hash differs from DEFAULT + every sibling)

  // --- CLIMATE FIELD FREQUENCIES (noise) ---------------------------------------------------------
  // The fen humidity lever: a shorter period packs the humid (marsh-prone) belts tighter so the no-pin
  // fabric mosaics swamp/river/ocean at a walkable grain. The rest stay DEFAULT.
  base.noise = {
    ...base.noise,
    humidity: { period: 1024, octaves: 6, spread: 2, gain: 0.5 }, // (was 1536) tighter wet belts
  }

  // --- TERRAIN SHAPING SPLINES (the flat scarred waterland) ---------------------------------------
  base.splines = {
    // Pinned tight around the waterline (128), 123..133 — a horizontal battlefield; the +2 over the fen's
    // inland cap gives the barrow moors a readable dry back.
    continentalness_to_base: [
      [0.0, 123],
      [0.3, 127],
      [0.55, 129],
      [0.8, 131],
      [1.0, 133],
    ],
    // Relief CAPPED LOW: hummocks + barrow rises, never hills.
    erosion_to_amplitude: [
      [0.0, 14],
      [0.3, 9],
      [0.6, 6],
      [0.8, 4],
      [1.0, 3],
    ],
    // A REAL negative dip (flooded shell-crater pools) + low rises (the barrows).
    pv_to_relief: [
      [0.0, -0.4],
      [0.3, -0.1],
      [0.5, 0.05],
      [0.75, 0.2],
      [1.0, 0.35],
    ],
  }

  // --- 3D DENSITY / OVERHANG GATE (keep it FLAT) --------------------------------------------------
  base.density = {
    ...base.density,
    warp: { period: 240, octaves: 2, amp: 15 }, // smooth horizontal marchland
    detail: { period: 132, octaves: 4, amp: 18 }, // subtle churned-earth detail only
    overhang: { erosion_max: 0.2, pv_min: 0.9, strength: 0.6 }, // effectively shut — no spikes on a marsh
  }

  // --- HYDROLOGY (the trench-and-crater patchwork — the fen recipe, war-scarred) ------------------
  base.hydrology = {
    ...base.hydrology,
    // TRENCH channels: dense, broad, shallow — flooded war-trenches threading the flats.
    river: {
      ...base.hydrology.river,
      crease: { period: 360, octaves: 3 }, // (was 560) dense trench net
      warp: { period: 520, octaves: 2, amp: 90 }, // meandering dug lines
      width: 0.3, // (was 0.12) broad slow channels
      depth: 5, // (was 11) shallow trench water
      bank: 1, // (was 3) water at the land surface — drowned banks
      continentalness_min: 0.34, // trenches reach the lagoon fringe
    },
    // CRATER pools: many small shallow basins pocking every hollow.
    lake: {
      period: 200, // (was 320) more, smaller basins
      octaves: 2,
      threshold: 0.62, // (was 0.72) more candidate pool area
      erosion_min: 0.4,
      pv_max: 0.45,
      min_body_depth: 2, // shallow crater pools survive the puddle gate
    },
  }

  // --- WATER OPTICS (milky corpse-grey — ash-silted, near-opaque) ---------------------------------
  base.water = {
    body_color: [0.06, 0.065, 0.06], // flat lifeless grey
    shallow_color: [0.16, 0.17, 0.15], // pale ash-milk margin
    sigma: [1.4, 1.3, 1.5], // everything dies fast, evenly ⇒ neutral grey murk
    fade_start: 0.8, // opaque almost immediately — you do not see into a grave-pool
    tint_depth: 2.8,
    deep_floor: 0.1,
  }

  // --- TEXTURE IDENTITY (the BONE / ASH war-graves palette) ---------------------------------------
  base.textures = {
    families: {
      grass: { hue: -30, sat: 0.45, val: 0.72 }, // sickly grey-green sedge
      foliage: { hue: -28, sat: 0.5, val: 0.6 }, // dead-grey canopy remnants
      wood: { sat: 0.6, val: 0.4 }, // blackened war timber
      dirt: { sat: 0.55, val: 0.6 }, // churned grey mud
      sand: { sat: 0.3, val: 0.95 }, // bone-pale flats
      stone: { sat: 0.6, val: 0.65 }, // tombstone grey
      water: { sat: 0.4, val: 0.7 }, // pale silted water texture
    },
  }

  // --- SKY ISLANDS OFF (a grounded grave-marsh) ---------------------------------------------------
  base.sky = { ...base.sky, enabled: false }

  // --- BIOME SELECTION: pin-only members gated out of climate placement ---------------------------
  // The fen-proven pair: a humidity-only placement bias makes SWAMP win the no-pin fabric (with the
  // swamp point pulled toward the field means below); river keeps the true pv≈0 trench valleys and
  // ocean the low-continentalness drowned fringe. The gated members place ONLY via region pins.
  base.biome_selection = {
    ...base.biome_selection,
    climate_bias: { humidity: 0.2 },
    weirdness_esoteric_threshold: 1.0,
  }

  // --- S-25 SUB-BIOME REGION LAYER (world-as-planet) — six war-marsh sub-biomes -------------------
  // Terrain knobs LIVE on the classes (S-25+ region-driven terrain). Band edges at the MEASURED field
  // percentiles (probe_rdist method, seed charnel-war-barrow: p13=0.309 p25=0.387 p65=0.574 p78=0.638
  // p88=0.695) — area split ≈ 13/12/40/13/10/12, the no-pin open marches widest, the grave pools the
  // rare dread feature. blend 0.05 cross-fades borders. Pins name REGISTRY biomes.
  base.regions = {
    enabled: true,
    field: { period: 1500, octaves: 2 }, // regions span ~0.75-1.5 km
    warp: { period: 750, octaves: 2, amp: 300 }, // organic band pockets
    blend: 0.05,
    variance: { period: 240, octaves: 2 },
    // TERRAIN KNOBS (S-25+ region-driven terrain, own settings): war-marsh morphology — every relief <1
    // (LOW & WET like the fen), trench lines and grave pools SINK below the mosaic, the ossuary flats lie
    // dead-flat, the barrow moor alone rises in low mounds (the war-graves silhouette).
    classes: [
      {
        name: 'wight_wood',
        upto: 0.309,
        biome: 'dense_forest',
        relief_scale: 0.5,
        height_bias: -1,
        roughness_scale: 0.7,
      }, // blackened snag woods in the wet (~13%)
      { name: 'trench_margin', upto: 0.387, biome: 'river', relief_scale: 0.35, height_bias: -3, roughness_scale: 0.6 }, // flooded trench lines (~12%)
      { name: 'open_marches', upto: 0.574 }, // NO PIN — dominant (~40%), the swamp/river/ocean mosaic (identity)
      { name: 'bone_flats', upto: 0.638, biome: 'desert', relief_scale: 0.3, height_bias: 1, roughness_scale: 0.4 }, // dead-flat bone-pale ossuary ground (~13%)
      {
        name: 'grave_pools',
        upto: 0.695,
        biome: 'void_marsh',
        relief_scale: 0.5,
        height_bias: -4,
        roughness_scale: 0.7,
      }, // sunken still grey pools + bare mud (~10%)
      { name: 'barrow_moor', upto: 1.01, biome: 'grassland', relief_scale: 0.65, height_bias: 3, roughness_scale: 0.8 }, // low war-barrow mounds (~12%)
    ],
  }

  // --- STRUCTURE POOL OVERRIDES (REGISTRY-name keys — all LIVE on this world) ---------------------
  // void_marsh has no BIOME_SCHEMATICS row ⇒ overrides-only dead trees + mud mounds (the fen path).
  // grassland barrows get dead stands + granite erratics (tombstone boulders); the bone flats bare rock.
  base.structure_pool_overrides = {
    swamp: ['pool_dead_trees', 'pool_mud_mounds'],
    dense_forest: ['pool_swamp_trees', 'pool_dead_trees'],
    void_marsh: ['pool_dead_trees', 'pool_mud_mounds'],
    grassland: ['pool_dead_trees', 'pool_rocks_granite'],
    desert: ['pool_rocks_granite'],
  }

  // --- TREE SPECIES (REGISTRY-name keys) ----------------------------------------------------------
  // Dead-snag dominant everywhere (a war grave grows corpses of trees); the marsh fabric keeps a few
  // living buttress survivors. dense_forest drops its temperate oak/birch (wight wood = standing dead).
  base.tree_species = {
    ...base.tree_species,
    swamp: [
      { species: 'dead_snag', weight: 3 },
      { species: 'swamp_buttress', weight: 2 },
    ],
    dense_forest: [
      { species: 'dead_snag', weight: 3 },
      { species: 'swamp_buttress', weight: 1 },
    ],
    grassland: [{ species: 'dead_snag', weight: 1 }],
    desert: [{ species: 'dead_snag', weight: 1 }],
  }

  // --- DECORATION (reed-choked margins, no meadow cheer) ------------------------------------------
  base.decoration = {
    ...base.decoration,
    reed_one_in: 1, // every water-margin column grows a reed — the trench fringe
    shore_band: 4, // broad wet margin
    reed_min_grass: 0, // reeds fire on all shores regardless of biome
    tall_cluster_one_in: 2, // grey sedge patches across the flats
    flower_patch_one_in: 14, // a war grave, not a prairie
    // Grave accents: cattails + swamp weed on the margins, moss + toadstools in the wight woods,
    // dead branches + pebbles strewn across the flats. No temperate fern carpet.
    sprites: {
      fern: false,
      cattail: true,
      swamp_weed: true,
      moss_tuft: true,
      toadstool: true,
      dead_branch: true,
      pebbles: true,
    },
  }

  // --- BIOME TABLE: REGISTRY names/ids. UNGATED fabric = ocean/river/swamp (the no-pin mosaic);
  // GATED pin-only = dense_forest/grassland/desert/void_marsh. Beds are grey mud; the only sand is the
  // bone-pale flats + channel silt (recolored). No beach ⇒ no flatten.
  base.biomes = [
    {
      id: 0,
      name: 'ocean',
      climate: { temperature: 0.55, humidity: 0.7, continentalness: 0.05, erosion: 0.85, pv: 0.3 },
      weight: 1.4,
      weirdness_gate: false,
      land: { surface: 'dirt', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: [],
      music_bed: 'ocean',
    }, // the drowned fringe — grey mud beds
    {
      id: 2,
      name: 'river',
      climate: { temperature: 0.55, humidity: 0.8, continentalness: 0.5, erosion: 0.85, pv: 0.02 },
      weight: 1.2,
      weirdness_gate: false,
      land: { surface: 'dirt', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
      tree_density: 0.04,
      grass_density: 0.45,
      structure_pools: [],
      music_bed: 'river',
    }, // flooded trench lines — silt beds, reed margins
    {
      id: 6,
      name: 'swamp',
      // Pulled toward the FIELD MEANS (the fen lesson — the registry point loses the fabric to river).
      climate: { temperature: 0.5, humidity: 0.85, continentalness: 0.58, erosion: 0.75, pv: 0.38 },
      weight: 1.4,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.1,
      grass_density: 0.7,
      structure_pools: ['pool_dead_trees', 'pool_mud_mounds'],
      music_bed: 'swamp',
    }, // the ashen-marsh fabric — grey sedge, dead stands
    // PIN-ONLY members (weirdness_gate:true ⇒ region pins only).
    {
      id: 5,
      name: 'dense_forest',
      climate: { temperature: 0.5, humidity: 0.9, continentalness: 0.6, erosion: 0.85, pv: 0.4 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'dirt', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.28,
      grass_density: 0.3,
      structure_pools: ['pool_swamp_trees', 'pool_dead_trees'],
      music_bed: 'swamp',
    }, // wight_wood — dense standing-dead timber on bare mud
    {
      id: 3,
      name: 'grassland',
      climate: { temperature: 0.5, humidity: 0.7, continentalness: 0.62, erosion: 0.9, pv: 0.45 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.02,
      grass_density: 0.55,
      structure_pools: ['pool_dead_trees', 'pool_rocks_granite'],
      music_bed: 'swamp',
    }, // barrow_moor — low mounds, tombstone erratics
    {
      id: 10,
      name: 'desert',
      climate: { temperature: 0.6, humidity: 0.3, continentalness: 0.6, erosion: 0.85, pv: 0.45 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'sand', subsurface: 'sand', underwater: 'sand', filler: 'stone' },
      tree_density: 0.01,
      grass_density: 0.05,
      structure_pools: ['pool_rocks_granite'],
      music_bed: 'esoteric',
    }, // bone_flats — pale ossuary sand
    {
      id: 16,
      name: 'void_marsh',
      climate: { temperature: 0.4, humidity: 0.95, continentalness: 0.55, erosion: 0.95, pv: 0.25 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'dirt', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.03,
      grass_density: 0.1,
      structure_pools: ['pool_dead_trees', 'pool_mud_mounds'],
      music_bed: 'esoteric',
    }, // grave_pools — bare mud + still grey water
  ]

  return base
}

/** The CHARNEL MARCHES world recipe (world 14) — pass to `create_engine({ world_config })`. */
export const CHARNEL_MARCHES_WORLD = build_charnel_marches()
