// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD 07 · CINDERFORGE DEPTHS (on-chain `07_cinderforge_depths`, biome `magma_foundry`) — THE
// cave/forge planet. Seed identity (seed/mainnet/07_cinderforge_depths/world.json): fire+air elements,
// "heat-tiered veins — deeper and hotter mines richer", "the ore-farm world — best duskite rate in the
// band; the forge-cult hammers on". The engine identity: a dark FORGE-CRATER land — black basalt crag
// belts split by deep lava-cut rifts, grey ash flats, charred standing forge-woods, slag-glass fields,
// jagged basalt crowns — and MAGMA where water would be: the seas and runs in the low basins glow molten
// (per-world water optics; the same H2O gen, dressed as the foundry's melt).
//
// ─── ARCHITECTURE (the S-25 fan-out pattern; ember_steppe = the closest sibling, re-tuned DARKER) ──────
// A CLASSIC-SPLINE world (massif OFF): the region layer's terrain knobs WERE inert pre-2026-07-13 — now LIVE on the spline path (S-25+ region-driven terrain, column_gen.raw_land_no_cirque; see TERRAIN KNOBS on the classes) (the classes below carry them). The region layer PINS the BIOME per column; TERRAIN comes from
// the tuned splines (badland-belt erosion curve + basalt spike pv knee), the cranked overhang gate, and
// the ADDITIVE CANYON stage — the "Depths" read: deep rift ravines cutting toward the magma line.
//
// DEAD-CONFIG LAW (declared): `carvers.caves` is NOT config-threaded (carvers/caves.js reads its module
// CAVES_CONFIG — create_cave_carver takes no world blob), so this recipe does NOT ship cave knobs; the
// default near-surface crust caves already run here. The cave-mine IDENTITY rides live levers only:
// the canyon rifts, the overhang undercuts, and the magma optics. Heat-tiered veins are seed/gameplay.
//
// DECORATION-KEY LAW (surface_decorator.js:491): `structure_pool_overrides` + `tree_species` keys are
// REGISTRY names (the paradise idiom); evocative names ride the region CLASSES. obsidian_spires/alpine
// carry NO BIOME_SCHEMATICS row ⇒ their volcanic-rock overrides fire at the override fallback densities.

import { DEFAULT_WORLD_GEN_CONFIG } from '../world_gen_config.js'

/** @typedef {import('../world_gen_config.js').WorldGenConfig & { name: string, biome_pin: string }} NamedWorldConfig */

/**
 * Builds the cinderforge-depths recipe: a deep clone of the live DEFAULT (inherits every field this lane
 * does not tune, so it tracks the schema) + the forge-crater overrides + the world identity metadata.
 * @returns {NamedWorldConfig}
 */
function build_cinderforge_depths() {
  const base = /** @type {NamedWorldConfig} */ (structuredClone(DEFAULT_WORLD_GEN_CONFIG))

  base.name = 'cinderforge_depths'
  base.biome_pin = 'magma_foundry'
  base.seed = 'cinderforge-embercore' // probed for the region-field percentiles below (a local probe script)
  base.version = 1 // cinderforge-depths recipe lineage v1 (config_hash differs from DEFAULT + every sibling)

  // --- CLIMATE FIELD FREQUENCIES (noise) — the terrain-variety source on a spline world ----------
  // erosion a touch shorter than DEFAULT ⇒ crag belts alternate with ash basins at a busy forge grain;
  // weirdness slightly longer than ember's ⇒ the basalt-crown ridge chains stay coherent, not a bump field.
  base.noise = {
    ...base.noise,
    erosion: { period: 1300, octaves: 6, spread: 2, gain: 0.5 }, // (was 1024) crag belts vs ash basins
    weirdness: { period: 600, octaves: 4, spread: 2, gain: 0.5 }, // (was 512) coherent basalt-crown chains
  }

  // --- TERRAIN SHAPING SPLINES (crater country over a magma line) --------------------------------
  base.splines = {
    // Low-continentalness basins dip UNDER the waterline (116 < 128) ⇒ MAGMA SEAS pool in the deeps
    // (the foundry's melt — water optics below); the inland rises to a 170 forge-back.
    continentalness_to_base: [
      [0.0, 116],
      [0.18, 124],
      [0.4, 136],
      [0.65, 148],
      [0.85, 158],
      [1.0, 170],
    ],
    // Crag amplitude: tall at low erosion (dramatic forge-crag belts) collapsing to flat ash plains.
    // Peak math: 170 + 118 ≈ 288 ≪ the 382 cap.
    erosion_to_amplitude: [
      [0.0, 118],
      [0.25, 88],
      [0.5, 48],
      [0.75, 20],
      [1.0, 8],
    ],
    // Basalt-crown curve: flat floors across the low/mid PV range, then a hard ramp — sudden dark
    // spikes over the flats (the crown country the alpine pin dresses bare).
    pv_to_relief: [
      [0.0, -0.18],
      [0.3, 0.0],
      [0.55, 0.12],
      [0.75, 0.45],
      [0.9, 0.8],
      [1.0, 1.0],
    ],
  }

  // --- 3D DENSITY / OVERHANG GATE (undercut forge spires) ----------------------------------------
  base.density = {
    ...base.density,
    warp: { period: 280, octaves: 3, amp: 32 }, // meandering crag faces
    detail: { period: 130, octaves: 5, amp: 36 }, // jagged ridged basalt detail
    // Gate opens on the low-erosion + high-pv crown columns ⇒ mushrooming undercut spires; the ash
    // flats stay clean. Bounded (max lift ≈ 1.7·36 ≈ 61 blocks).
    overhang: { erosion_max: 0.5, pv_min: 0.52, strength: 1.7 },
  }

  // --- CANYON STAGE (the DEPTHS — lava-cut rifts) -------------------------------------------------
  // The additive deeper carve (ember's proven lever, cranked): a second rift network cuts the crag belts
  // into near-vertical ravines that drop toward the magma line — the mine-shaft/forge-rift read.
  base.carvers = {
    ...base.carvers,
    canyon: { enabled: true, width: 0.075, depth: 52, wall_steepness: 2.6, warp: true },
  }

  // --- STRATA BANDING (forge-seam banding on the steep rift/crag walls) ---------------------------
  // Slope-gated: steep faces band into basalt with glowing ember-dirt seams (the `dirt` family is
  // recolored ember-red below) — heat-tiered strata on every rift wall. Flats keep their cover.
  base.strata = {
    ...base.strata,
    enabled: true,
    band_height: 7,
    band_jitter: 4,
    slope_gate: 1.25, // vertical rift/crag walls only
    palette: ['stone', 'dirt', 'stone'], // basalt / ember seam / basalt
  }

  // --- WATER OPTICS (MAGMA — glowing molten seas + runs) ------------------------------------------
  // The identity hero: every water body reads as melt. Red-orange body, bright molten margin, red-only
  // transmission, near-instant opacity, and a HIGH deep_floor (the melt self-glows, never goes black).
  base.water = {
    body_color: [0.36, 0.07, 0.01], // molten core red-orange
    shallow_color: [0.85, 0.3, 0.05], // bright glowing margin
    sigma: [0.3, 1.9, 2.6], // red survives, green/blue die ⇒ hot orange tint
    fade_start: 0.4, // opaque almost immediately (liquid rock)
    tint_depth: 1.6,
    deep_floor: 0.45, // strong residual glow — magma is a light source, not a depth
  }

  // --- TEXTURE IDENTITY (the BASALT / EMBER palette — darker than ember_steppe's ash grey) --------
  // Per-family HSV recolor of the shared atlas (baked copy + LOD far-shell): near-black basalt, dark
  // ash, ember-red seam soil, scorched olive-black survivor scrub, charcoal timber, molten water texture.
  base.textures = {
    families: {
      stone: { sat: 0.45, val: 0.4 }, // near-black basalt (crags/crowns/slag)
      sand: { hue: -8, sat: 0.5, val: 0.5 }, // dark forge ash (deeper than ember's 0.72 grey)
      dirt: { hue: -12, sat: 1.5, val: 0.55 }, // ember-red seam soil (the strata glow line)
      grass: { hue: -18, sat: 0.55, val: 0.5 }, // scorched dark scrub
      foliage: { hue: -20, sat: 0.6, val: 0.45 }, // charred canopy remnants
      wood: { hue: -10, sat: 0.8, val: 0.32 }, // charcoal forge-wood
      water: { hue: 165, sat: 1.6, val: 1.1 }, // molten texture shift (blue → glowing orange)
    },
  }

  // --- SKY ISLANDS OFF (a grounded, downward world) -----------------------------------------------
  base.sky = { ...base.sky, enabled: false }

  // --- BIOME SELECTION: hot placement bias + pin-only members gated out ---------------------------
  // A placement-only heat bias (the rainforest-proven lever) pulls the fabric hot so desert/scorched win
  // the no-pin band; river keeps the true pv≈0 rift valleys (magma runs) and ocean the low basins (magma
  // seas). taiga/obsidian_spires/alpine place ONLY via region pins (threshold 1.0 gates them out).
  base.biome_selection = {
    ...base.biome_selection,
    climate_bias: { temperature: 0.3 },
    weirdness_esoteric_threshold: 1.0,
  }

  // --- S-25 SUB-BIOME REGION LAYER (world-as-planet) — six forge sub-biomes ------------------------
  // Terrain knobs LIVE on the classes (S-25+ region-driven terrain). Band edges at the MEASURED field
  // percentiles (probed locally, seed cinderforge-embercore: p13=0.300 p26=0.393 p66=0.591
  // p78=0.652 p88=0.712) — area split ≈ 13/13/40/12/10/12, the no-pin cinder barrens widest, the crater
  // forge the rare hero. blend 0.05 cross-fades borders. Pins name REGISTRY biomes.
  base.regions = {
    enabled: true,
    field: { period: 1600, octaves: 2 }, // regions span ~0.8-1.6 km
    warp: { period: 800, octaves: 2, amp: 320 }, // organic band pockets
    blend: 0.05,
    variance: { period: 240, octaves: 2 },
    // TERRAIN KNOBS (S-25+ region-driven terrain, own settings): forge-crater morphology — the melt runs
    // cut low braided banks, the slag glass lies dead-flat, the crater forge SINKS into a broken glowing
    // bowl, the basalt crowns spike high and jagged over it all.
    classes: [
      { name: 'forge_woods', upto: 0.3, biome: 'taiga', relief_scale: 0.9, height_bias: 2, roughness_scale: 1.0 }, // charred standing timber (~13%)
      { name: 'magma_runs', upto: 0.393, biome: 'river', relief_scale: 0.55, height_bias: -4, roughness_scale: 0.8 }, // low braided melt-run banks (~13%)
      { name: 'cinder_barrens', upto: 0.591 }, // NO PIN — dominant (~40%), the hot ash/rock fabric (identity)
      {
        name: 'slag_fields',
        upto: 0.652,
        biome: 'obsidian_spires',
        relief_scale: 0.25,
        height_bias: -1,
        roughness_scale: 0.3,
      }, // dead-flat black slag-glass (~12%)
      {
        name: 'crater_forge',
        upto: 0.712,
        biome: 'scorched_badlands',
        relief_scale: 0.8,
        height_bias: -6,
        roughness_scale: 1.2,
      }, // the sunken broken crater heart (~10%)
      { name: 'basalt_crown', upto: 1.01, biome: 'alpine', relief_scale: 1.6, height_bias: 9, roughness_scale: 1.6 }, // jagged basalt spike country (~12%)
    ],
  }

  // --- STRUCTURE POOL OVERRIDES (REGISTRY-name keys) ----------------------------------------------
  // Volcanic (SCORCHED_ROCK_LAVA — lava-glinting) rocks are the world's texture: they join every rock
  // set. obsidian_spires/alpine have NO BIOME_SCHEMATICS row ⇒ overrides-only at fallback density; taiga's
  // forge woods add dead-tree schematics under the proc snags.
  base.structure_pool_overrides = {
    desert: ['pool_rocks_volcanic'],
    scorched_badlands: ['pool_rocks_volcanic'],
    taiga: ['pool_dead_trees', 'pool_rocks_volcanic'],
    obsidian_spires: ['pool_rocks_volcanic'],
    alpine: ['pool_rocks_volcanic'],
  }

  // --- TREE SPECIES (REGISTRY-name keys; charred rosters) -----------------------------------------
  // taiga = the forge woods: charred snags dominant + rare survivor spruce (tree_one_in 9 base density).
  // desert ash grows only lonely snags. alpine is EMPTIED ⇒ bare basalt crowns. scorched_badlands is
  // treeless by its base row (tree_one_in 0). river/ocean carry no roster ⇒ bare magma banks.
  base.tree_species = {
    ...base.tree_species,
    taiga: [
      { species: 'dead_snag', weight: 3 },
      { species: 'spruce_mid', weight: 1 },
    ],
    desert: [{ species: 'dead_snag', weight: 1 }],
    alpine: [],
  }

  // --- DECORATION (burnt, rocky — the rock-farm read) ---------------------------------------------
  base.decoration = {
    ...base.decoration,
    tree_grove_one_in: 7, // (DEFAULT 3) lonely charred stands
    rock_grove_one_in: 3, // (DEFAULT 6) heavy volcanic scatter — THE forge/ore world texture
    // A foundry grows no meadow clutter; no reeds on a magma bank.
    sprites: { tall_grass: false, fern: false, flower: false, reed: false },
  }

  // --- BIOME TABLE: REGISTRY names/ids. UNGATED fabric = ocean/river/desert/scorched_badlands (the
  // no-pin cinder-barrens mosaic — magma seas, magma runs, ash flats, cinder rock); GATED pin-only =
  // taiga/obsidian_spires/alpine. All beds are dark rock — nothing bright under the molten glow. -----
  base.biomes = [
    {
      id: 0,
      name: 'ocean',
      climate: { temperature: 0.8, humidity: 0.3, continentalness: 0.05, erosion: 0.8, pv: 0.3 },
      weight: 1.4,
      weirdness_gate: false,
      land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: [],
      music_bed: 'esoteric',
    }, // the magma seas — basalt beds under the melt
    {
      id: 2,
      name: 'river',
      climate: { temperature: 0.75, humidity: 0.35, continentalness: 0.5, erosion: 0.7, pv: 0.02 },
      weight: 1.1,
      weirdness_gate: false,
      land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: [],
      music_bed: 'esoteric',
    }, // magma runs — bare basalt banks (the magma_runs pin + the true pv≈0 valleys)
    {
      id: 10,
      name: 'desert',
      // Pulled onto the MEASURED field mass (probe_cinder_fabric.mjs: fabric samples sit at h≈0.5,
      // pv≈0.10 — the pv fold bottom-loads) + a weight lead, so the ash fabric WINS the no-pin band;
      // river keeps only the true pv≲0.05 fold-valleys. At the registry-ish point (h0.22/pv0.42) river
      // took 37% of the world — the drowned_fen fabric lesson, re-measured on this lane.
      climate: { temperature: 0.78, humidity: 0.42, continentalness: 0.55, erosion: 0.75, pv: 0.12 },
      weight: 1.5,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'dirt', underwater: 'stone', filler: 'stone' },
      tree_density: 0.01,
      grass_density: 0.03,
      structure_pools: ['pool_rocks_volcanic'],
      music_bed: 'desert',
    }, // the dark ash flats — the barrens fabric
    {
      id: 11,
      name: 'scorched_badlands',
      climate: { temperature: 0.88, humidity: 0.3, continentalness: 0.62, erosion: 0.35, pv: 0.55 },
      weight: 1.1,
      weirdness_gate: false,
      land: { surface: 'stone', subsurface: 'dirt', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0.02,
      structure_pools: ['pool_rocks_volcanic'],
      music_bed: 'desert',
    }, // cinder rock belts + the pinned crater_forge heart (SCORCHED_ROCK_LAVA glints)
    // PIN-ONLY members (weirdness_gate:true ⇒ region pins only).
    {
      id: 7,
      name: 'taiga',
      climate: { temperature: 0.7, humidity: 0.35, continentalness: 0.62, erosion: 0.6, pv: 0.5 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'dirt', subsurface: 'dirt', underwater: 'stone', filler: 'stone' },
      tree_density: 0.14,
      grass_density: 0.05,
      structure_pools: ['pool_dead_trees', 'pool_rocks_volcanic'],
      music_bed: 'taiga',
    }, // forge_woods — charred standing-dead timber on charcoal floor
    {
      id: 15,
      name: 'obsidian_spires',
      climate: { temperature: 0.75, humidity: 0.15, continentalness: 0.74, erosion: 0.2, pv: 0.8 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: ['pool_rocks_volcanic'],
      music_bed: 'esoteric',
    }, // slag_fields — flat black glass
    {
      id: 13,
      name: 'alpine',
      climate: { temperature: 0.6, humidity: 0.2, continentalness: 0.72, erosion: 0.15, pv: 0.88 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: ['pool_rocks_volcanic'],
      music_bed: 'alpine',
    }, // basalt_crown — bare undercut spike country
  ]

  return base
}

/** The CINDERFORGE DEPTHS world recipe (world 07) — pass to `create_engine({ world_config })`. */
export const CINDERFORGE_DEPTHS_WORLD = build_cinderforge_depths()
