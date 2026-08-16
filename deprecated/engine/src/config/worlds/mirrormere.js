// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD 13 · MIRRORMERE (on-chain `13_mirrormere`, biome `frost_lake`) — the mirror-lake planet. Seed
// identity (seed/mainnet/13_mirrormere/world.json): water+air elements, "mirror ice — the lake reflects
// a second world; the reflection walks at night", "the frost-forge crafting hub — THE first +1 AP ring
// chase; the Frost Dragon sleeps below". The engine identity: a COLD STILL LAKE-LAND — broad mirror
// meres filling every hollow (the cranked lake stage IS the world), snow shores and frost formations,
// frosted cathedral spruce woods, hard glacier panes, frozen reed fens — and the frost-fanged dragon
// spire crags. The water is the clearest in the game: a mirror, not a window.
//
// ─── ARCHITECTURE (the S-25 fan-out pattern) ────────────────────────────────────────────────────────────
// A CLASSIC-SPLINE world (massif OFF): the region layer's terrain knobs WERE inert pre-2026-07-13 — now LIVE on the spline path (S-25+ region-driven terrain, column_gen.raw_land_no_cirque; see TERRAIN KNOBS on the classes) (the classes below carry them). The region layer PINS the BIOME per column; the MERE mosaic
// comes from a low near-waterline base curve (sub-sea meres) + the CRANKED pour-point lake stage
// (threshold 0.55 — broad mirror lakes pond every hollow), rivers threading mere to mere.
//
// DECORATION-KEY LAW (surface_decorator.js:491): `structure_pool_overrides` + `tree_species` keys are
// REGISTRY names (the paradise idiom); evocative names ride the region CLASSES. pool_ice's ARCTIC
// ICEFORME/ICEPIC formations are the frost furniture on every snow shore.

import { DEFAULT_WORLD_GEN_CONFIG } from '../world_gen_config.js'

/** @typedef {import('../world_gen_config.js').WorldGenConfig & { name: string, biome_pin: string }} NamedWorldConfig */

/**
 * Builds the mirrormere recipe: a deep clone of the live DEFAULT (inherits every field this lane does
 * not tune, so it tracks the schema) + the frost-lake overrides + the world identity metadata.
 * @returns {NamedWorldConfig}
 */
function build_mirrormere() {
  const base = /** @type {NamedWorldConfig} */ (structuredClone(DEFAULT_WORLD_GEN_CONFIG))

  base.name = 'mirrormere'
  base.biome_pin = 'frost_lake'
  base.seed = 'mirrormere-frost-dragon' // probed for the region-field percentiles below (a local probe script)
  base.version = 1 // mirrormere recipe lineage v1 (config_hash differs from DEFAULT + every sibling)

  // --- CLIMATE FIELD FREQUENCIES (noise) ---------------------------------------------------------
  // Long soft fields — a still world: broad belts, slow swells, nothing busy between the meres.
  base.noise = {
    ...base.noise,
    erosion: { period: 1500, octaves: 6, spread: 2, gain: 0.5 }, // (was 1024) broad soft belts
    weirdness: { period: 750, octaves: 3, spread: 2, gain: 0.5 }, // (was 512/o4) slow frost swells
  }

  // --- TERRAIN SHAPING SPLINES (low lake-land) ----------------------------------------------------
  base.splines = {
    // Low near the waterline: the low-cont range dips under 128 (broad sub-sea meres); the inland
    // rises only to 146 — a horizontal mirror country.
    continentalness_to_base: [
      [0.0, 118],
      [0.25, 127],
      [0.5, 131],
      [0.75, 137],
      [1.0, 146],
    ],
    // Relief LOW: soft shore swells; only the rare low-erosion belt lifts toward crag country.
    // Peak math: 146 + 44 = 190 ≪ the 382 cap.
    erosion_to_amplitude: [
      [0.0, 44],
      [0.3, 24],
      [0.6, 10],
      [0.8, 6],
      [1.0, 4],
    ],
    // Mere hollows to dragon fangs: a REAL negative dip (every pv hollow ponds into a mirror), long
    // flat shoulders, a late hard ramp to the spires.
    pv_to_relief: [
      [0.0, -0.3],
      [0.35, -0.05],
      [0.6, 0.12],
      [0.85, 0.5],
      [1.0, 1.0],
    ],
  }

  // --- 3D DENSITY / OVERHANG GATE (frost-fang lips only) ------------------------------------------
  base.density = {
    ...base.density,
    warp: { period: 250, octaves: 2, amp: 16 }, // smooth frozen ground
    detail: { period: 140, octaves: 4, amp: 18 }, // subtle rime detail
    // Gate opens only on the rare spire columns ⇒ fanged undercut crags; the shores stay soft.
    overhang: { erosion_max: 0.3, pv_min: 0.75, strength: 1.1 },
  }

  // --- HYDROLOGY (THE MIRRORMERE — the cranked lake stage IS the world) ---------------------------
  base.hydrology = {
    ...base.hydrology,
    river: {
      ...base.hydrology.river,
      width: 0.18, // broad still connectors threading mere to mere
      depth: 7,
      bank: 1, // water at the land surface — brimming meres
    },
    lake: {
      period: 420, // (was 320) BIG basins — lake-sized mirrors, not ponds
      octaves: 2,
      threshold: 0.55, // (was 0.72) most hollows qualify — the world IS its lakes
      erosion_min: 0.35, // even gentle country ponds
      pv_max: 0.5,
      min_body_depth: 2, // shallow mirror panes survive the puddle gate
    },
  }

  // --- WATER OPTICS (the MIRROR — the clearest, stillest water in the game) -----------------------
  base.water = {
    body_color: [0.02, 0.08, 0.14], // deep ice-blue
    shallow_color: [0.28, 0.5, 0.62], // luminous glacial shallows
    sigma: [0.55, 0.3, 0.22], // extreme clarity, blue transmits
    fade_start: 4.5, // you see the bed — until the mirror takes over
    tint_depth: 13.0,
    deep_floor: 0.2,
  }

  // --- TEXTURE IDENTITY (the FROST palette) -------------------------------------------------------
  // Per-family HSV recolor of the shared atlas (baked copy + LOD far-shell). The hero move: STONE →
  // ice-BLUE frost rock (sat up on the near-grey base — the everest idiom); frost-pale ground, frosted
  // spruce canopy, silvered timber, pale shores.
  base.textures = {
    families: {
      stone: { hue: 215, sat: 1.45, val: 0.95 }, // ice-blue frost rock
      grass: { hue: 25, sat: 0.5, val: 1.0 }, // frost-pale blue-green ground
      foliage: { hue: 18, sat: 0.55, val: 0.85 }, // frosted spruce canopy
      dirt: { sat: 0.6, val: 0.7 }, // cold dark loam
      sand: { hue: 10, sat: 0.25, val: 1.05 }, // pale frost-grey shore
      wood: { sat: 0.6, val: 0.85 }, // silvered timber
      water: { hue: 5, sat: 1.1, val: 1.05 }, // ice-clear texture
    },
  }

  // --- SKY ISLANDS OFF (the second world lives IN the lake) ---------------------------------------
  base.sky = { ...base.sky, enabled: false }

  // --- BIOME SELECTION: pin-only members gated out of climate placement ---------------------------
  // No bias: arctic's point sits ON the field means with a weight lead (the proven fabric formula —
  // the point's coordinates are placement math, its LAND/decoration make it "arctic") ⇒ snow-shore
  // country IS the fabric; river keeps the pv-fold connectors and ocean the deep meres. taiga/glacier/
  // alpine/swamp place ONLY via region pins.
  base.biome_selection = {
    ...base.biome_selection,
    weirdness_esoteric_threshold: 1.0,
  }

  // --- S-25 SUB-BIOME REGION LAYER (world-as-planet) — six frost sub-biomes ------------------------
  // Terrain knobs LIVE on the classes (S-25+ region-driven terrain). Band edges at the MEASURED field
  // percentiles (probed locally, seed mirrormere-frost-dragon: p13=0.314 p26=0.387
  // p66=0.565 p78=0.625 p88=0.692) — area split ≈ 13/13/40/12/10/13, the no-pin mere country widest,
  // the dragon spires the rare menace. blend 0.05 cross-fades borders. Pins name REGISTRY biomes.
  base.regions = {
    enabled: true,
    field: { period: 1500, octaves: 2 }, // regions span ~0.75-1.5 km
    warp: { period: 750, octaves: 2, amp: 300 }, // organic band pockets
    blend: 0.05,
    variance: { period: 240, octaves: 2 },
    // TERRAIN KNOBS (S-25+ region-driven terrain, own settings): still lake-land morphology — gentle snow
    // shores, dead-flat hard glacier panes (the mirror), frost-fanged dragon crags rearing over the meres,
    // low frozen fens. mere_country keeps the recipe's cranked-lake fabric (the lake stage IS the world).
    classes: [
      { name: 'frost_shore', upto: 0.314, biome: 'arctic', relief_scale: 0.5, height_bias: 0, roughness_scale: 0.5 }, // gentle snow shores + ice formations (~13%)
      { name: 'rime_wood', upto: 0.387, biome: 'taiga', relief_scale: 0.85, height_bias: 2, roughness_scale: 1.0 }, // frosted cathedral spruce (~13%)
      { name: 'mere_country', upto: 0.565 }, // NO PIN — dominant (~40%), the lake-land fabric (identity)
      {
        name: 'glacier_pane',
        upto: 0.625,
        biome: 'glacier',
        relief_scale: 0.3,
        height_bias: -1,
        roughness_scale: 0.25,
      }, // DEAD-FLAT hard blue ice sheets — the mirror (~12%)
      { name: 'dragon_spires', upto: 0.692, biome: 'alpine', relief_scale: 1.6, height_bias: 9, roughness_scale: 1.6 }, // frost-fanged crag country (~10%)
      { name: 'winter_fen', upto: 1.01, biome: 'swamp', relief_scale: 0.4, height_bias: -2, roughness_scale: 0.5 }, // low frozen reed fen (~13%)
    ],
  }

  // --- STRUCTURE POOL OVERRIDES (REGISTRY-name keys) ----------------------------------------------
  // pool_ice (ICEFORME/ICEPIC formations) is the world's furniture: frost sculptures on the snow
  // shores, panes and pressure ridges on the glacier, fangs at the spire feet. Conifer schematics
  // back the rime wood; frozen snags stand in the fen.
  base.structure_pool_overrides = {
    arctic: ['pool_ice', 'pool_rocks_alpine'],
    glacier: ['pool_ice'],
    taiga: ['pool_conifers'],
    alpine: ['pool_ice', 'pool_rocks_alpine'],
    swamp: ['pool_dead_trees'],
  }

  // --- TREE SPECIES (REGISTRY-name keys) ----------------------------------------------------------
  // Snow shores: bleached snags + rare hardy spruce (the DEFAULT arctic roster, kept explicit); the
  // rime wood keeps the CATHEDRAL pines (frosted towers over the meres — the one vertical awe here);
  // the frozen fen drowned snags; the dragon spires are EMPTIED ⇒ bare fangs.
  base.tree_species = {
    ...base.tree_species,
    arctic: [
      { species: 'dead_snag', weight: 2 },
      { species: 'spruce_mid', weight: 1 },
    ],
    taiga: [
      { species: 'pine_cathedral', weight: 4 },
      { species: 'spruce_mid', weight: 2 },
    ],
    swamp: [
      { species: 'dead_snag', weight: 2 },
      { species: 'spruce_mid', weight: 1 },
    ],
    alpine: [],
  }

  // --- DECORATION (still, frost-etched) -----------------------------------------------------------
  base.decoration = {
    ...base.decoration,
    reed_one_in: 2,
    shore_band: 3, // reed fringes ring every mere
    reed_min_grass: 0, // reeds on all shores regardless of biome
    flower_patch_one_in: 16, // near-zero bloom — a frozen world
    // Frost accents: frozen shrubs + lichen on the cold ground (arctic/glacier/alpine accents),
    // cattails at the mere margins. No temperate fern carpet.
    sprites: { fern: false, flower: false, frozen_shrub: true, lichen: true, cattail: true },
  }

  // --- BIOME TABLE: REGISTRY names/ids. UNGATED fabric = ocean/river/arctic (the no-pin mere-country
  // mosaic — deep meres, connectors, snow shores); GATED pin-only = taiga/glacier/alpine/swamp. Beds
  // are pale frost sand — the mirror reads against white. -------------------------------------------
  base.biomes = [
    {
      id: 0,
      name: 'ocean',
      climate: { temperature: 0.4, humidity: 0.6, continentalness: 0.05, erosion: 0.8, pv: 0.3 },
      weight: 1.4,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: [],
      music_bed: 'ocean',
    }, // the deep meres — pale beds under the mirror
    {
      id: 2,
      name: 'river',
      climate: { temperature: 0.45, humidity: 0.65, continentalness: 0.5, erosion: 0.7, pv: 0.02 },
      weight: 1.0,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
      tree_density: 0.04,
      grass_density: 0.4,
      structure_pools: [],
      music_bed: 'river',
    }, // still connectors threading mere to mere
    {
      id: 8,
      name: 'arctic',
      // ON the field means + a weight lead (the proven fabric formula) ⇒ snow-shore country IS the
      // fabric; its snow surface + ice furniture carry the read, not the point's semantics.
      climate: { temperature: 0.45, humidity: 0.55, continentalness: 0.6, erosion: 0.7, pv: 0.1 },
      weight: 1.5,
      weirdness_gate: false,
      land: { surface: 'snow', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.03,
      grass_density: 0.12,
      structure_pools: ['pool_ice', 'pool_rocks_alpine'],
      music_bed: 'arctic',
    }, // the snow-shore fabric between the meres
    // PIN-ONLY members (weirdness_gate:true ⇒ region pins only).
    {
      id: 7,
      name: 'taiga',
      climate: { temperature: 0.3, humidity: 0.5, continentalness: 0.68, erosion: 0.6, pv: 0.5 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.2,
      grass_density: 0.3,
      structure_pools: ['pool_conifers'],
      music_bed: 'taiga',
    }, // rime_wood — frosted cathedral pines
    {
      id: 9,
      name: 'glacier',
      climate: { temperature: 0.05, humidity: 0.85, continentalness: 0.6, erosion: 0.5, pv: 0.6 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'snow', subsurface: 'snow', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: ['pool_ice'],
      music_bed: 'arctic',
    }, // glacier_pane — hard blue sheets, pressure-ridge ice forms
    {
      id: 13,
      name: 'alpine',
      climate: { temperature: 0.2, humidity: 0.45, continentalness: 0.72, erosion: 0.15, pv: 0.85 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0.04,
      structure_pools: ['pool_ice', 'pool_rocks_alpine'],
      music_bed: 'esoteric',
    }, // dragon_spires — bare frost-fanged crags (the Frost Dragon's teeth)
    {
      id: 6,
      name: 'swamp',
      climate: { temperature: 0.35, humidity: 0.9, continentalness: 0.58, erosion: 0.9, pv: 0.32 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.08,
      grass_density: 0.5,
      structure_pools: ['pool_dead_trees'],
      music_bed: 'swamp',
    }, // winter_fen — frozen reed flats, drowned snags
  ]

  return base
}

/** The MIRRORMERE world recipe (world 13) — pass to `create_engine({ world_config })`. */
export const MIRRORMERE_WORLD = build_mirrormere()
