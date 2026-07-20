// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD 08 · PALEWOOD (on-chain `08_palewood`, biome `pale_forest`) — the ghost-forest planet. Seed
// identity (seed/mainnet/08_palewood/world.json): air+water elements, "fog-phase mobs — shapes fade in
// and out of the mist", "dread emptiness by design — low variety, the best rare rates in the band;
// Nerak sleeps below". The engine identity: a BLEACHED BONE-PALE forest land under milk light — open
// pale woodland rolling over subdued swells, close birch-bone thickets, gaunt dead-pine rises, empty
// bone flats, still milk-water meres — and the black hollow country where Nerak sleeps.
//
// "LOW VARIETY" IS THE DESIGN: this recipe deliberately mutes relief, kills flower/color clutter, and
// runs one desaturated palette across every family — the emptiness reads on purpose, the variety comes
// from the six region moods, not from color.
//
// ─── ARCHITECTURE (the S-25 fan-out pattern) ────────────────────────────────────────────────────────────
// A CLASSIC-SPLINE world (massif OFF): the region layer's terrain knobs WERE inert pre-2026-07-13 — now LIVE on the spline path (S-25+ region-driven terrain, column_gen.raw_land_no_cirque; see TERRAIN KNOBS on the classes) (the classes below carry them). The region layer PINS the BIOME per column; the subdued swell
// TERRAIN comes from the muted splines + a near-shut overhang gate (no drama — dread is flat).
//
// DECORATION-KEY LAW (surface_decorator.js:491): `structure_pool_overrides` + `tree_species` keys are
// REGISTRY names (the paradise idiom); evocative names ride the region CLASSES. void_marsh has NO
// BIOME_SCHEMATICS row ⇒ its dead-tree/mud-mound overrides fire at the override fallback densities.

import { DEFAULT_WORLD_GEN_CONFIG } from '../world_gen_config.js'

/** @typedef {import('../world_gen_config.js').WorldGenConfig & { name: string, biome_pin: string }} NamedWorldConfig */

/**
 * Builds the palewood recipe: a deep clone of the live DEFAULT (inherits every field this lane does
 * not tune, so it tracks the schema) + the bone-pale overrides + the world identity metadata.
 * @returns {NamedWorldConfig}
 */
function build_palewood() {
  const base = /** @type {NamedWorldConfig} */ (structuredClone(DEFAULT_WORLD_GEN_CONFIG))

  base.name = 'palewood'
  base.biome_pin = 'pale_forest'
  base.seed = 'palewood-nerak-sleep' // probed for the region-field percentiles below (a local probe script)
  base.version = 1 // palewood recipe lineage v1 (config_hash differs from DEFAULT + every sibling)

  // --- CLIMATE FIELD FREQUENCIES (noise) ---------------------------------------------------------
  // Long, few-octave weirdness ⇒ soft coherent swells (no busy ridging); long erosion ⇒ broad gentle
  // belts. The dread land is SMOOTH — mist does the drama.
  base.noise = {
    ...base.noise,
    erosion: { period: 1400, octaves: 6, spread: 2, gain: 0.5 }, // (was 1024) broad soft belts
    weirdness: { period: 800, octaves: 3, spread: 2, gain: 0.5 }, // (was 512/o4) slow pale swells
  }

  // --- TERRAIN SHAPING SPLINES (subdued rolling lowland) ------------------------------------------
  base.splines = {
    // Low-continentalness fringes dip just under the waterline (124 < 128) ⇒ shallow milk meres; the
    // inland rises only to 150 — a horizontal, hushed world.
    continentalness_to_base: [
      [0.0, 124],
      [0.25, 130],
      [0.5, 136],
      [0.75, 143],
      [1.0, 150],
    ],
    // Relief capped LOW everywhere: swells, never crags (30 max at the rare low-erosion rise).
    erosion_to_amplitude: [
      [0.0, 30],
      [0.3, 20],
      [0.6, 12],
      [0.8, 8],
      [1.0, 5],
    ],
    // A gentle swing: shallow glen dips (mere hollows) to soft rises — walkable everywhere.
    pv_to_relief: [
      [0.0, -0.25],
      [0.3, -0.05],
      [0.55, 0.12],
      [0.8, 0.3],
      [1.0, 0.45],
    ],
  }

  // --- 3D DENSITY / OVERHANG GATE (keep it soft) --------------------------------------------------
  base.density = {
    ...base.density,
    warp: { period: 250, octaves: 2, amp: 14 }, // (was amp 26) smooth pale ground
    detail: { period: 135, octaves: 4, amp: 16 }, // (was amp 34) subtle only
    // Effectively shut: no undercuts in a hushed flatland.
    overhang: { erosion_max: 0.25, pv_min: 0.85, strength: 0.6 },
  }

  // --- HYDROLOGY (still meres + slow pale streams) ------------------------------------------------
  base.hydrology = {
    ...base.hydrology,
    river: {
      ...base.hydrology.river,
      crease: { period: 480, octaves: 3 }, // a slightly denser slow-stream net
      width: 0.2, // (was 0.12) broad slow water
      depth: 7, // (was 11) shallow pale channels
      bank: 2, // (was 3) water near the land surface
    },
    lake: {
      ...base.hydrology.lake,
      period: 260, // (was 320) more mere basins
      threshold: 0.62, // (was 0.72) more of the flats pond
      min_body_depth: 2, // shallow still meres survive the puddle gate
    },
  }

  // --- WATER OPTICS (MILK — pale, near-colorless, short sight) ------------------------------------
  // Fog-water: an even, desaturated extinction (no hue survives), opaque fast — the mere is a mirror
  // of the pale sky, never a window.
  base.water = {
    body_color: [0.16, 0.17, 0.16], // pale grey-green milk
    shallow_color: [0.34, 0.36, 0.33], // lighter milk margin
    sigma: [1.4, 1.3, 1.4], // even extinction — colorless mist water
    fade_start: 0.9, // short sight
    tint_depth: 3.0,
    deep_floor: 0.22,
  }

  // --- TEXTURE IDENTITY (the BONE-PALE palette — the "dread emptiness" carrier) -------------------
  // Per-family HSV recolor of the shared atlas (baked copy + LOD far-shell): near-white bark, washed
  // grey-green ground, ashen loam, pale silt, milk water. Desaturation IS the identity.
  base.textures = {
    families: {
      grass: { sat: 0.35, val: 1.06 }, // washed grey-green ground
      foliage: { sat: 0.28, val: 1.12 }, // whitish ghost canopy
      wood: { sat: 0.22, val: 1.18 }, // bone-white bark (the birch wood reads skeletal)
      dirt: { sat: 0.45, val: 0.9 }, // ashen loam
      stone: { sat: 0.5, val: 1.02 }, // pale grey
      sand: { sat: 0.3, val: 1.08 }, // bone silt shores
      water: { sat: 0.25, val: 1.1 }, // milk texture
    },
  }

  // --- SKY ISLANDS OFF (a grounded, hushed world) --------------------------------------------------
  base.sky = { ...base.sky, enabled: false }

  // --- BIOME SELECTION: pin-only members gated out of climate placement ---------------------------
  // No climate bias: temperate_forest's point sits ON the field means (below) with a weight lead, so
  // the pale-wood fabric wins the no-pin band natively; river keeps the pv-fold valleys and ocean the
  // low-cont mere fringes. dense_forest/taiga/void_marsh place ONLY via region pins.
  base.biome_selection = {
    ...base.biome_selection,
    weirdness_esoteric_threshold: 1.0,
  }

  // --- S-25 SUB-BIOME REGION LAYER (world-as-planet) — six pale sub-biomes -------------------------
  // Terrain knobs LIVE on the classes (S-25+ region-driven terrain). Band edges at the MEASURED field
  // percentiles (probed locally, seed palewood-nerak-sleep: p13=0.293 p26=0.363 p66=0.570
  // p78=0.634 p88=0.696) — area split ≈ 13/13/40/12/10/13, the no-pin palewood widest, the Nerak
  // hollow the rare dread heart. blend 0.05 cross-fades borders. Pins name REGISTRY biomes.
  base.regions = {
    enabled: true,
    field: { period: 1800, octaves: 2 }, // broad regions — you walk a long time in one mood
    warp: { period: 900, octaves: 2, amp: 340 }, // organic band pockets
    blend: 0.05,
    variance: { period: 250, octaves: 2 },
    // TERRAIN KNOBS (S-25+ region-driven terrain, own settings): subdued dread morphology — gaunt
    // dead-pine RISES stand over the swells, the bone flats lie empty and dead-flat (the dread IS the
    // emptiness), Nerak's hollow SINKS black and deep, the mist meres dip to still milk-water.
    classes: [
      {
        name: 'pale_thicket',
        upto: 0.293,
        biome: 'dense_forest',
        relief_scale: 0.8,
        height_bias: 1,
        roughness_scale: 0.9,
      }, // close birch-bone wood (~13%)
      { name: 'gallows_rise', upto: 0.363, biome: 'taiga', relief_scale: 1.0, height_bias: 5, roughness_scale: 1.1 }, // gaunt dead-pine rises (~13%)
      { name: 'palewood', upto: 0.57 }, // NO PIN — dominant (~40%), the open pale-forest fabric (identity)
      { name: 'bone_flats', upto: 0.634, biome: 'grassland', relief_scale: 0.3, height_bias: 0, roughness_scale: 0.4 }, // empty DEAD-FLAT dread country (~12%)
      {
        name: 'nerak_hollow',
        upto: 0.696,
        biome: 'void_marsh',
        relief_scale: 0.5,
        height_bias: -7,
        roughness_scale: 0.8,
      }, // the sunken black hollow — Nerak sleeps (~10%)
      { name: 'mist_mere', upto: 1.01, biome: 'river', relief_scale: 0.45, height_bias: -3, roughness_scale: 0.5 }, // still milk-water mere margins (~13%)
    ],
  }

  // --- STRUCTURE POOL OVERRIDES (REGISTRY-name keys) ----------------------------------------------
  // Birch schematics carry the bone-wood read; dead trees haunt the flats and rises; void_marsh (no
  // BIOME_SCHEMATICS row) gets dead trees + mud mounds — the Nerak hollow's black furniture.
  base.structure_pool_overrides = {
    temperate_forest: ['pool_birch'],
    dense_forest: ['pool_birch'],
    taiga: ['pool_dead_trees'],
    grassland: ['pool_dead_trees'],
    void_marsh: ['pool_dead_trees', 'pool_mud_mounds'],
  }

  // --- TREE SPECIES (REGISTRY-name keys; skeletal rosters) -----------------------------------------
  // birch_slim (pale bark) dominates every wood; dead snags thread the emptiness. taiga drops its
  // cathedral pines for gaunt snags + rare spruce. river margins grow lone birches.
  base.tree_species = {
    ...base.tree_species,
    temperate_forest: [
      { species: 'birch_slim', weight: 4 },
      { species: 'oak_broadleaf', weight: 1 },
      { species: 'dead_snag', weight: 1 },
    ],
    dense_forest: [
      { species: 'birch_slim', weight: 4 },
      { species: 'dead_snag', weight: 1 },
    ],
    grassland: [
      { species: 'dead_snag', weight: 1 },
      { species: 'birch_slim', weight: 1 },
    ],
    taiga: [
      { species: 'dead_snag', weight: 3 },
      { species: 'spruce_mid', weight: 1 },
    ],
    river: [{ species: 'birch_slim', weight: 1 }],
  }

  // --- DECORATION (hushed — no color clutter; skeletal accents only) ------------------------------
  base.decoration = {
    ...base.decoration,
    flower_patch_one_in: 20, // (DEFAULT 6) near-zero bloom — dread emptiness
    tall_cluster_one_in: 8, // (DEFAULT 5) sparse grass accents
    path_one_in: 4, // (DEFAULT 5) more bare walking lanes through the woods
    // No meadow color. Skeletal opt-ins: toadstools under the pale canopy, dry bush/branches/pebbles
    // on the bone flats (grassland accents).
    sprites: { flower: false, toadstool: true, bush: true, dead_branch: true, pebbles: true },
  }

  // --- BIOME TABLE: REGISTRY names/ids. UNGATED fabric = ocean/river/temperate_forest/grassland (the
  // no-pin palewood mosaic); GATED pin-only = dense_forest/taiga/void_marsh. Everything desaturates
  // through the bone palette — the table stays structurally plain on purpose (low variety by design).
  base.biomes = [
    {
      id: 0,
      name: 'ocean',
      climate: { temperature: 0.5, humidity: 0.6, continentalness: 0.05, erosion: 0.8, pv: 0.3 },
      weight: 1.4,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: [],
      music_bed: 'ocean',
    }, // the pale mere fringes — bone-silt beds
    {
      id: 2,
      name: 'river',
      climate: { temperature: 0.5, humidity: 0.65, continentalness: 0.5, erosion: 0.7, pv: 0.02 },
      weight: 1.1,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
      tree_density: 0.08,
      grass_density: 0.4,
      structure_pools: [],
      music_bed: 'river',
    }, // slow milk streams + the mist_mere pin — lone birches at the margins
    {
      id: 4,
      name: 'temperate_forest',
      // ON the field means (t/h ≈ 0.5, pv at the fold mass ≈ 0.12) + a weight lead ⇒ the pale wood IS
      // the fabric (the cinderforge/drowned fabric lesson, applied at authoring time).
      climate: { temperature: 0.5, humidity: 0.55, continentalness: 0.6, erosion: 0.62, pv: 0.12 },
      weight: 1.4,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.16,
      grass_density: 0.45,
      structure_pools: ['pool_birch'],
      music_bed: 'forest',
    }, // the open pale woodland fabric
    {
      id: 3,
      name: 'grassland',
      climate: { temperature: 0.55, humidity: 0.32, continentalness: 0.65, erosion: 0.82, pv: 0.15 },
      weight: 1.1,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.02,
      grass_density: 0.55,
      structure_pools: ['pool_dead_trees'],
      music_bed: 'grassland',
    }, // bone flats — empty, a lone snag on the skyline
    // PIN-ONLY members (weirdness_gate:true ⇒ region pins only).
    {
      id: 5,
      name: 'dense_forest',
      climate: { temperature: 0.48, humidity: 0.7, continentalness: 0.62, erosion: 0.68, pv: 0.3 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.3,
      grass_density: 0.4,
      structure_pools: ['pool_birch'],
      music_bed: 'forest',
    }, // pale_thicket — the close birch-bone wood
    {
      id: 7,
      name: 'taiga',
      climate: { temperature: 0.35, humidity: 0.45, continentalness: 0.68, erosion: 0.6, pv: 0.5 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.14,
      grass_density: 0.25,
      structure_pools: ['pool_dead_trees'],
      music_bed: 'taiga',
    }, // gallows_rise — gaunt snag stands on the rises
    {
      id: 16,
      name: 'void_marsh',
      climate: { temperature: 0.4, humidity: 0.9, continentalness: 0.55, erosion: 0.9, pv: 0.25 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'dirt', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.03,
      grass_density: 0.08,
      structure_pools: ['pool_dead_trees', 'pool_mud_mounds'],
      music_bed: 'esoteric',
    }, // nerak_hollow — bare black earth under the mist
  ]

  return base
}

/** The PALEWOOD world recipe (world 08) — pass to `create_engine({ world_config })`. */
export const PALEWOOD_WORLD = build_palewood()
