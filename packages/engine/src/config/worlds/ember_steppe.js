// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIVE WORLDS · EMBER-STEPPE (world 03 = on-chain `03_emberfall_steppe`, biome `ash_steppe`) — the
// volcanic ash-plain planet. WORLD→RECIPE MAPPING (grounded, DECLARED): the three release worlds map
// first_shore→paradise, verdant_hollow→rainforest, emberfall_steppe→THIS. World 03 had NO engine recipe
// among the five (rainforest/riviera/everest/everglades/paradise); `riviera` was an unbuilt DEFAULT-clone
// placeholder and the closest arid lean, so world 03 TAKES the riviera slot (index.js: riviera→ember_steppe).
// everglades (swamp) is the opposite lean; declared, not silently improvised.
//
// Visual north star (a world = a planet in its own environment: a LOT of terrain
// variety, no two locations alike, 5-6 sub-biomes minimum): a burnt, fire+earth steppe — grey ash flats,
// standing-dead cinder woods, lava-cut badland canyons, flat black obsidian glass fields, rare olive ember
// oases, and jagged dark-basalt columns. The S-25 REGION LAYER partitions it into six named sub-biomes.
//
// ─── ARCHITECTURE (the S-25 fan-out pattern; everest = the pattern-setter) ─────────────────────────────
// everest is a MASSIF world, so its region layer MODULATES terrain (relief/height/roughness) AND pins the
// biome. Ember-steppe is a CLASSIC-SPLINE world (massif OFF), where the region layer's terrain knobs are
// INERT (only `massif_surface` consumes relief_scale/height_bias/roughness_scale — column_gen raw_land is
// biome-independent on the spline path). So here the region layer pins the BIOME per column (surface/
// subsurface blocks + decoration pools + tree species + per-biome density), while TERRAIN VARIETY comes
// from the tuned CLIMATE splines: erosion→badland amplitude (flat steppe ↔ tall mesas) and pv→basalt
// spikes (flat floors ↔ sudden columns). The region terrain knobs are since 2026-07-13 CARRIED on the classes (region-driven terrain) — previously omitted as// dead config on a spline world — declared, not shipped inert). Same mechanism as paradise + rainforest.
//
// CONFIG-ONLY lane — every lever is a value the gen/render pipeline already consumes; no engine code is
// touched. Ember palette = the per-family `textures` HSV recolor (the everest ice-blue / everglades bayou
// idiom): stone→basalt-black, sand→ash-grey, dirt→charred, grass→muted olive. There are no dedicated
// ash/basalt/obsidian BLOCKS, so the identity rides the recolor of stone/sand/dirt + the SCORCHED_ROCK_LAVA
// rock schematic (scorched_badlands' native rock pool, lava-glinting) + pool_rocks_volcanic.

import { DEFAULT_WORLD_GEN_CONFIG } from '../world_gen_config.js'

/** @typedef {import('../world_gen_config.js').WorldGenConfig & { name: string, biome_pin: string }} NamedWorldConfig */

/**
 * Builds the ember-steppe recipe: a deep clone of the live DEFAULT (inherits every field this lane does
 * not tune, so it tracks the schema) + the volcanic-steppe overrides + the world identity metadata.
 * @returns {NamedWorldConfig}
 */
function build_ember_steppe() {
  const base = /** @type {NamedWorldConfig} */ (structuredClone(DEFAULT_WORLD_GEN_CONFIG))

  base.name = 'ember_steppe'
  base.biome_pin = 'ash_steppe'
  base.seed = 'emberfall-ashfall' // seed-swept (a local probe script) for the region-field percentiles below
  base.version = 1 // ember-steppe recipe lineage v1 (config_hash differs from DEFAULT + every sibling)

  // --- CLIMATE FIELD FREQUENCIES (noise) — the terrain-variety source on a spline world ----------
  // erosion sets the scale over which flat ash STEPPE (high erosion) alternates with tall badland MESAS
  // (low erosion); weirdness drives PV = the folded-ridge lines the basalt COLUMNS spike along. Both a
  // touch shorter than DEFAULT so the badland belts + column chains pack denser (a busy volcanic field).
  base.noise = {
    ...base.noise,
    erosion: { period: 1400, octaves: 6, spread: 2, gain: 0.5 }, // (was 1024) broad badland belts vs steppe basins
    weirdness: { period: 560, octaves: 4, spread: 2, gain: 0.5 }, // (was 512) denser basalt-column ridge chains
  }

  // --- TERRAIN SHAPING SPLINES (rolling steppe + badland mesas + basalt spikes) ------------------
  // NO OCEAN (fire+earth steppe): the whole inland sits ABOVE the dropped sea_level (below), so
  // nothing floods — a dry ash plain. base 120-168 = a gently rolling steppe floor.
  base.splines = {
    // Rolling steppe: low-continentalness ash flats ~120, high inland mesabacks ~168. All well above the
    // dropped sea_level (8) ⇒ a genuinely dry, landlocked steppe (no coast, no shelf).
    continentalness_to_base: [
      [0.0, 120],
      [0.22, 138],
      [0.46, 150],
      [0.7, 158],
      [1.0, 168],
    ],
    // BADLAND amplitude: tall at low erosion (dramatic mesa/canyon relief) collapsing fast to a flat ash
    // steppe at high erosion — so low-erosion belts read as eroded badlands, high-erosion basins as flats.
    erosion_to_amplitude: [
      [0.0, 112],
      [0.25, 80],
      [0.5, 46],
      [0.72, 22],
      [1.0, 8],
    ],
    // BASALT-COLUMN curve: relief ≈0 across a wide low/mid PV range (flat steppe/badland floors), ramping
    // hard from the pv≈0.7 knee to 1.0 at the ridge crossings — sudden dark spikes over the flats.
    pv_to_relief: [
      [0.0, -0.15],
      [0.35, 0.0],
      [0.6, 0.14],
      [0.8, 0.5],
      [0.92, 0.82],
      [1.0, 1.0],
    ],
  }

  // --- HYDROLOGY (BONE DRY — a fire+earth steppe has no rivers/ocean) ---------------------------
  // Sea level dropped far BELOW the steppe floor (config-threaded flood base, gen/hydrology.js) ⇒ zero
  // ambient flooding. Rivers + pour-point lakes DISABLED via impossible gates (continentalness_min > 1,
  // lake threshold > 1) — a blue river threading an ash steppe reads wrong AND drowns the hardcoded spawn
  // (D186). The world is dry rock + ash; the ember_oasis sub-biome is dressing (olive scrub), not water.
  base.hydrology = {
    ...base.hydrology,
    sea_level: 8,
    river: { ...base.hydrology.river, continentalness_min: 1.0 }, // continentalness < 1 always ⇒ river_strength 0 (no channels)
    lake: { ...base.hydrology.lake, threshold: 1.0 }, // basin sample never > 1 ⇒ no basin qualifies (no ponds)
  }

  // --- 3D DENSITY / OVERHANG GATE (the undercutting basalt columns) -----------------------------
  base.density = {
    ...base.density,
    warp: { period: 280, octaves: 3, amp: 30 }, // meandering, non-repeating column faces
    detail: { period: 130, octaves: 5, amp: 34 }, // ridged jagged basalt detail
    // Gate opens on the tall low-erosion + high-pv column columns ⇒ they undercut into dark basalt spires;
    // the flat steppe/badland floors (high erosion) stay clean. Bounded (max lift ≈ 1.6·34 ≈ 54 blocks).
    overhang: { erosion_max: 0.5, pv_min: 0.55, strength: 1.6 },
  }

  // --- STRATA BANDING (badland sedimentary bands on the steep mesa/canyon faces) -----------------
  // Slope-gated: only steep columns (mesa walls / canyon flanks) band into horizontal scoria/ash/basalt
  // layers; the flat steppe floor keeps its biome cover. Recoloured to basalt/charred/ash by `textures`.
  base.strata = {
    ...base.strata,
    enabled: true,
    band_height: 6,
    band_jitter: 4,
    slope_gate: 1.2, // only the vertical mesa/canyon faces expose banded rock; shoulders keep cover
    palette: ['stone', 'dirt', 'sand'], // basalt / charred seam / ash band (via the ember textures recolor)
  }

  // --- CANYON STAGE (lava-cut badland canyons — the additive deeper carve) -----------------------
  // The worked desert example's mesa lever: a second, deeper canyon network cuts the badland belts into
  // lava-cut ravines. Warped for sinuous, drainage-like walls. The SCORCHED_ROCK_LAVA rock pool (scorched_
  // badlands' native rocks) + pool_rocks_volcanic glint lava in the cuts.
  base.carvers = { ...base.carvers, canyon: { enabled: true, width: 0.07, depth: 46, wall_steepness: 2.4, warp: true } }

  // --- WATER OPTICS (dark ember pools — dim, red-shifted, near-opaque) --------------------------
  base.water = {
    body_color: [0.11, 0.03, 0.02], // deep ember red-black
    shallow_color: [0.28, 0.09, 0.04], // dim molten-orange margin
    sigma: [0.6, 1.6, 2.0], // red penetrates, green/blue die fast ⇒ hot red tint, short sight
    fade_start: 1.0,
    tint_depth: 3.5,
    deep_floor: 0.12,
  }

  // --- TEXTURE IDENTITY (the EMBER / BASALT palette) -------------------------------------------
  // Per-family HSV recolor of the shared atlas (baked copy + LOD far-shell). stone→dark basalt-black, sand→
  // grey ash, dirt→charred red-brown seam, grass/foliage→muted survivor olive (the ember_oasis life), wood→
  // charred black. hue is degrees; sat/val are multipliers on the recipe base colours.
  base.textures = {
    families: {
      stone: { sat: 0.5, val: 0.42 }, // basalt black (the badland/column/obsidian hero rock)
      sand: { hue: -6, sat: 0.28, val: 0.72 }, // grey volcanic ash
      dirt: { hue: -6, sat: 1.05, val: 0.5 }, // charred red-brown soil / strata seam
      grass: { hue: -14, sat: 0.6, val: 0.68 }, // muted dark olive (rare oasis survivor scrub)
      foliage: { hue: -14, sat: 0.6, val: 0.6 }, // sparse charred-olive canopy
      wood: { hue: -10, sat: 0.9, val: 0.4 }, // charred black standing-dead timber
    },
  }

  // --- SKY ISLANDS OFF (grounded steppe) -------------------------------------------------------
  base.sky = { ...base.sky, enabled: false }

  // --- S-25 SUB-BIOME REGION LAYER (world-as-planet) — six named sub-biomes ----------------------
  // A low-freq warped fbm field r∈[0,1] partitions the steppe into six biome-pinned sub-biomes. Terrain
  // knobs (relief/height/roughness) LIVE on the classes (S-25+ region-driven terrain); ice stays massif-only. Band
  // edges from the MEASURED region-field percentiles (probed locally: even-area edges 0.343/
  // 0.427/0.502/0.578/0.671), re-weighted so ash_steppe + cinder_woods are the common baseline and
  // obsidian/oasis/basalt the rarer dramatic features. blend 0.05 cross-fades borders (no hard seams).
  // Every pin resolves against the biome table below (all six recoloured by the ember palette).
  base.regions = {
    enabled: true,
    field: { period: 2000, octaves: 2 }, // regions span ~1-2 km (you walk a while inside one)
    warp: { period: 1000, octaves: 2, amp: 360 }, // organic band pockets (not concentric rings)
    blend: 0.05,
    variance: { period: 260, octaves: 2 }, // (variance terrain amps left 0 — class knobs carry the terrain here)
    // TERRAIN KNOBS (S-25+ region-driven terrain, own settings — supersedes the "inert on a spline world"
    // note above): the ash flats roll gently, the badlands tear rough and low, the glass fields lie
    // dead-flat, the oasis sinks into its survivor basin, the basalt columns spike high and jagged.
    classes: [
      { name: 'ash_steppe', upto: 0.4, biome: 'ash_steppe', relief_scale: 0.8, height_bias: 0, roughness_scale: 0.8 }, // grey ash flats — the gently rolling baseline
      {
        name: 'cinder_woods',
        upto: 0.52,
        biome: 'cinder_woods',
        relief_scale: 0.9,
        height_bias: 2,
        roughness_scale: 1.0,
      }, // standing-dead charred forest
      {
        name: 'lava_badlands',
        upto: 0.63,
        biome: 'lava_badlands',
        relief_scale: 1.3,
        height_bias: -4,
        roughness_scale: 1.5,
      }, // torn lava-cut canyon country
      {
        name: 'obsidian_fields',
        upto: 0.72,
        biome: 'obsidian_fields',
        relief_scale: 0.25,
        height_bias: -2,
        roughness_scale: 0.3,
      }, // dead-flat black volcanic glass
      {
        name: 'ember_oasis',
        upto: 0.81,
        biome: 'ember_oasis',
        relief_scale: 0.5,
        height_bias: -5,
        roughness_scale: 0.6,
      }, // the sunken olive-scrub survivor basin
      {
        name: 'basalt_columns',
        upto: 1.01,
        biome: 'basalt_columns',
        relief_scale: 1.6,
        height_bias: 8,
        roughness_scale: 1.6,
      }, // jagged dark-basalt spire country
    ],
  }

  // --- STRUCTURE POOL OVERRIDES (scorched decoration per sub-biome) -----------------------------
  // Config-driven decorator hook (biome NAME → bundle pool ids merged onto the biome's rock/tree sets).
  // Rocks are schematic (never shadowed); proc trees ride tree_species below. Volcanic + sandstone rocks
  // scatter the badlands/columns; dead-tree schematics back the cinder woods.
  base.structure_pool_overrides = {
    ash_steppe: ['pool_rocks_sandstone'],
    cinder_woods: ['pool_dead_trees', 'pool_rocks_volcanic'],
    lava_badlands: ['pool_rocks_volcanic'],
    obsidian_fields: ['pool_rocks_volcanic'],
    basalt_columns: ['pool_rocks_volcanic'],
  }

  // --- DECORATION (sparse, burnt — no lush sprite clutter) -------------------------------------
  base.decoration = {
    ...base.decoration,
    tree_grove_one_in: 8, // (DEFAULT 3) lonely stands, not a forest on the ash
    rock_grove_one_in: 4, // more rock groves (volcanic scatter is the world's texture)
    // A burnt world grows no temperate/marsh clutter; a little dark olive scrub in the oases only.
    sprites: { tall_grass: false, fern: false, flower: false, reed: false, bush: true },
  }

  // --- TREE SPECIES (charred standing-dead + rare oasis scrub) ---------------------------------
  // Proc trees read tree_species[biome_name] + the biome's BIOME_SCHEMATICS tree_one_in density gate.
  // ash_steppe (desert id10, tree_one_in 90) = very sparse snags; cinder_woods (taiga id7, tree_one_in 9)
  // = moderate standing-dead; ember_oasis (grassland id3, tree_one_in 22) = rare olive acacia/palm.
  // The barren pins (lava_badlands/obsidian_fields/basalt_columns) get EMPTY rosters ⇒ bare rock.
  base.tree_species = {
    ...base.tree_species,
    ash_steppe: [{ species: 'dead_snag', weight: 1 }],
    cinder_woods: [
      { species: 'dead_snag', weight: 3 },
      { species: 'acacia_umbrella', weight: 1 },
    ],
    ember_oasis: [
      { species: 'acacia_umbrella', weight: 2 },
      { species: 'palm_curve', weight: 1 },
    ],
    lava_badlands: [],
    obsidian_fields: [],
    basalt_columns: [],
  }

  // --- BIOME TABLE: the six ember sub-biomes (registry ids REUSED — decoration resolves by id) ---
  // Each pin uses an EXISTING registry id (surface_decorator.get_biome_by_id + BIOME_SCHEMATICS are keyed
  // on the persisted id/name) so the schematic pools + density gates resolve; the per-world `name` is the
  // region pin + tree_species/structure_pool_overrides key. Land blocks are the ember-recoloured
  // stone/sand/dirt/grass. weirdness_gate:false (pins bypass climate placement; kept clean). NO OCEAN
  // member — the landlocked base + dropped sea leave no sub-sea columns.
  //   ash_steppe→desert(10)  cinder_woods→taiga(7)  lava_badlands→scorched_badlands(11)
  //   obsidian_fields→obsidian_spires(15)  ember_oasis→grassland(3)  basalt_columns→alpine(13)
  base.biomes = [
    {
      id: 10,
      name: 'ash_steppe',
      climate: { temperature: 0.95, humidity: 0.15, continentalness: 0.5, erosion: 0.75, pv: 0.4 },
      weight: 1,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'dirt', underwater: 'stone', filler: 'stone' },
      tree_density: 0.01,
      grass_density: 0.03,
      structure_pools: ['pool_rocks_sandstone'],
      music_bed: 'desert',
    },
    {
      id: 7,
      name: 'cinder_woods',
      climate: { temperature: 0.9, humidity: 0.35, continentalness: 0.62, erosion: 0.6, pv: 0.5 },
      weight: 1,
      weirdness_gate: false,
      land: { surface: 'dirt', subsurface: 'dirt', underwater: 'stone', filler: 'stone' },
      tree_density: 0.12,
      grass_density: 0.05,
      structure_pools: ['pool_dead_trees', 'pool_rocks_volcanic'],
      music_bed: 'desert',
    },
    {
      id: 11,
      name: 'lava_badlands',
      climate: { temperature: 0.98, humidity: 0.1, continentalness: 0.68, erosion: 0.35, pv: 0.66 },
      weight: 1,
      weirdness_gate: false,
      land: { surface: 'stone', subsurface: 'dirt', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: ['pool_rocks_volcanic', 'pool_rocks_sandstone'],
      music_bed: 'desert',
    },
    {
      id: 15,
      name: 'obsidian_fields',
      climate: { temperature: 0.75, humidity: 0.15, continentalness: 0.74, erosion: 0.2, pv: 0.8 },
      weight: 1,
      weirdness_gate: false,
      land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: ['pool_rocks_volcanic'],
      music_bed: 'esoteric',
    },
    {
      id: 3,
      name: 'ember_oasis',
      climate: { temperature: 0.7, humidity: 0.55, continentalness: 0.58, erosion: 0.7, pv: 0.35 },
      weight: 1,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.06,
      grass_density: 0.3,
      structure_pools: ['pool_desert_flora'],
      music_bed: 'desert',
    },
    {
      id: 13,
      name: 'basalt_columns',
      climate: { temperature: 0.8, humidity: 0.2, continentalness: 0.72, erosion: 0.15, pv: 0.9 },
      weight: 1,
      weirdness_gate: false,
      land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: ['pool_rocks_volcanic'],
      music_bed: 'alpine',
    },
  ]

  return base
}

/** The EMBER-STEPPE world recipe (world 03) — pass to `create_engine({ world_config })`. */
export const EMBER_STEPPE_WORLD = build_ember_steppe()
