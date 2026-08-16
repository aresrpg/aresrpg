// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD 04 · MISTRAL HEIGHTS (on-chain `04_mistral_heights`, biome `mesa`) — the windswept-highlands
// planet. Seed identity (seed/mainnet/04_mistral_heights/world.json): air+fire elements, "thermal
// updrafts — vertical lift between mesa tiers", miner-focus sky-ore veins, the Goblin Cave. The engine
// identity composes BOTH reads: a wind-scoured HIGHLAND (long ridgelines, alpine meadows, pine belts,
// scree fields, cold tarns in the glens) whose dry tablelands step into ochre MESA tiers (strata-banded
// plateau scarps — the world.json "mesa tiers" the updrafts ride between).
//
// ─── ARCHITECTURE (the S-25 fan-out pattern; ember_steppe = the closest sibling) ────────────────────────
// A CLASSIC-SPLINE world (massif OFF): the region layer's terrain knobs WERE inert pre-2026-07-13 — now LIVE on the spline path (S-25+ region-driven terrain, column_gen.raw_land_no_cirque; see TERRAIN KNOBS on the classes) here (only
// massif_surface consumes relief/height/roughness — column_gen raw_land is biome-independent on the
// spline path), so they are since 2026-07-13 CARRIED on the classes (region-driven terrain). The region layer PINS the
// BIOME per column (blocks + decoration + species + sprites); TERRAIN VARIETY comes from the tuned
// climate splines: erosion→amplitude (ridge belts ↔ meadow basins) and pv→relief (glens ↔ ridgelines),
// plus slope-gated STRATA that steps the steep plateau scarps into mesa bands.
//
// DECORATION-KEY LAW (proven on this lane, surface_decorator.js:491): the decorator resolves a column's
// biome via the MODULE registry (`get_biome_by_id`), so `structure_pool_overrides` + `tree_species` keys
// fire ONLY when keyed by REGISTRY biome names. This recipe therefore keeps REGISTRY names in the biome
// table (the paradise idiom — NOT ember/rainforest's renamed tables, whose custom keys are dead) and
// carries the evocative names on the region CLASSES instead.
//
// CONFIG-ONLY lane — every lever is a value the gen/render pipeline already consumes; no engine code is
// touched. Highland palette = per-family HSV recolor: pale windswept grass, grey granite, ochre plateau
// sand, weathered timber. NO ocean (a high inland world): the base curve sits above the waterline; only
// deep glens (low continentalness + pv dip) fall under 128 and pool into cold TARNS — deliberate.

import { DEFAULT_WORLD_GEN_CONFIG } from '../world_gen_config.js'

/** @typedef {import('../world_gen_config.js').WorldGenConfig & { name: string, biome_pin: string }} NamedWorldConfig */

/**
 * Builds the mistral-heights recipe: a deep clone of the live DEFAULT (inherits every field this lane
 * does not tune, so it tracks the schema) + the highland overrides + the world identity metadata.
 * @returns {NamedWorldConfig}
 */
function build_mistral_heights() {
  const base = /** @type {NamedWorldConfig} */ (structuredClone(DEFAULT_WORLD_GEN_CONFIG))

  base.name = 'mistral_heights'
  base.biome_pin = 'highland'
  base.seed = 'mistral-updraft' // probed for the region-field percentiles below (a local probe script)
  base.version = 1 // mistral-heights recipe lineage v1 (config_hash differs from DEFAULT + every sibling)

  // --- CLIMATE FIELD FREQUENCIES (noise) — the terrain-variety source on a spline world ----------
  // weirdness LONGER + fewer octaves ⇒ PV folds into LONG coherent ridgelines (windswept ranges, not a
  // bump field); erosion LONGER ⇒ broad ridge belts alternate with wide meadow/plateau basins.
  base.noise = {
    ...base.noise,
    erosion: { period: 1500, octaves: 6, spread: 2, gain: 0.5 }, // (was 1024) broad ridge belts vs meadow basins
    weirdness: { period: 900, octaves: 3, spread: 2, gain: 0.5 }, // (was 512/o4) long smooth ridgelines
  }

  // --- TERRAIN SHAPING SPLINES (rolling highland + ridge crests + stepped tablelands) ------------
  base.splines = {
    // High inland: the whole curve sits ABOVE the waterline (128) — no ocean; lowest ground 132 so only
    // the pv glen-dip below can pond (tarns). Gentle rise to a 178 tableland back.
    continentalness_to_base: [
      [0.0, 132],
      [0.2, 140],
      [0.4, 148],
      [0.6, 157],
      [0.8, 166],
      [1.0, 178],
    ],
    // Ridge amplitude: tall at low erosion (crests ~+120), stepping down through plateau country to
    // near-flat meadow basins. Peak math: 178 + 124 ≈ 302 ≪ the 382 cap.
    erosion_to_amplitude: [
      [0.0, 124],
      [0.22, 92],
      [0.45, 52],
      [0.68, 24],
      [0.85, 14],
      [1.0, 8],
    ],
    // Ridgeline curve: a real negative glen dip (cold tarns pool where low-cont meets the dip), flat
    // mid-shoulders, then a broad ramp to full crest relief — ridges you walk ALONG, not spike fields.
    pv_to_relief: [
      [0.0, -0.14],
      [0.28, 0.0],
      [0.5, 0.18],
      [0.72, 0.5],
      [0.88, 0.8],
      [1.0, 1.0],
    ],
  }

  // --- 3D DENSITY / OVERHANG GATE (wind-carved crags on the crests only) -------------------------
  base.density = {
    ...base.density,
    warp: { period: 260, octaves: 2, amp: 24 }, // meandering ridge faces
    detail: { period: 140, octaves: 4, amp: 30 }, // wind-notched crag detail
    // Gate opens only on the low-erosion + high-pv crest columns ⇒ wind-carved undercuts on the ridge
    // crowns; meadows/plateaus stay clean. Bounded (max lift ≈ 1.2·30 = 36 blocks).
    overhang: { erosion_max: 0.42, pv_min: 0.5, strength: 1.2 },
  }

  // --- STRATA BANDING (the MESA TIERS — ochre bands on the steep plateau scarps) -----------------
  // Slope-gated: only genuinely steep faces (plateau scarps, ridge walls) quantize into horizontal
  // stone/ochre/dirt bands — the world.json "mesa tiers". Flat meadows keep their biome cover.
  base.strata = {
    ...base.strata,
    enabled: true,
    band_height: 6,
    band_jitter: 3,
    slope_gate: 1.25, // vertical scarps only — shoulders + meadows keep cover
    palette: ['stone', 'sand', 'dirt'], // grey granite / ochre plateau band / earthy seam (recolored below)
  }

  // --- WATER OPTICS (cold clear highland tarns + streams) ----------------------------------------
  base.water = {
    body_color: [0.03, 0.11, 0.16], // cold steel-blue body
    shallow_color: [0.18, 0.4, 0.46], // clear glacial-fed shallows
    sigma: [0.7, 0.4, 0.34], // high clarity, blue-green transmits
    fade_start: 3.0,
    tint_depth: 8.0,
    deep_floor: 0.14,
  }

  // --- TEXTURE IDENTITY (the WINDSWEPT HIGHLAND palette) -----------------------------------------
  // Per-family HSV recolor of the shared atlas (baked copy + LOD far-shell). Pale wind-dried grass,
  // grey granite, warm OCHRE sand (the mesa-tier band + plateau tops), weathered dark timber.
  base.textures = {
    families: {
      grass: { hue: -8, sat: 0.85, val: 1.02 }, // pale windswept green (dried by the mistral)
      foliage: { hue: -6, sat: 0.9, val: 0.95 }, // wind-toughened canopy
      stone: { sat: 0.75, val: 0.92 }, // pale grey granite crests
      sand: { hue: -4, sat: 0.85, val: 1.0 }, // warm ochre plateau / mesa band
      dirt: { sat: 0.9, val: 0.8 }, // dry earthy seam
      wood: { sat: 0.9, val: 0.75 }, // weathered highland timber
    },
  }

  // --- SKY ISLANDS OFF (grounded highland — world 06 owns the floating masses) -------------------
  base.sky = { ...base.sky, enabled: false }

  // --- BIOME SELECTION: the pin-only members are ESOTERIC-gated out of climate placement ---------
  // weirdness_gate:true + threshold 1.0 (> any |w−0.5|·2 in practice) keeps desert/scorched_badlands OUT
  // of the candidate set, so the no-pin `highland` band is a pure grassland/taiga/alpine/river climate
  // fabric — the identity-preservation lever (the paradise/rainforest idiom).
  base.biome_selection = {
    ...base.biome_selection,
    weirdness_esoteric_threshold: 1.0,
  }

  // --- S-25 SUB-BIOME REGION LAYER (world-as-planet) — six highland sub-biomes --------------------
  // A low-freq warped fbm field r∈[0,1] partitions the highland. Terrain knobs LIVE on the classes (S-25+ region-driven terrain). Band edges at the MEASURED field percentiles
  // (probed locally, seed mistral-updraft: p13=0.305 p26≈0.389 p66≈0.596 p78≈0.658
  // p86≈0.709) — area split ≈ 13/13/40/12/8/14: the no-pin highland fabric is the widest band and the
  // dramatic pins (plateau/scarp/scree) the rarer features. blend 0.05 cross-fades borders (no hard
  // seams). Class pins name REGISTRY biomes (decoration-key law above).
  base.regions = {
    enabled: true,
    field: { period: 1600, octaves: 2 }, // regions span ~0.8-1.6 km
    warp: { period: 800, octaves: 2, amp: 320 }, // organic band pockets
    blend: 0.05,
    variance: { period: 240, octaves: 2 },
    // TERRAIN KNOBS (S-25+ region-driven terrain, own settings): highland morphology per region — open
    // flower meadows lie gentle, the mesa tableland stands RAISED with a smooth wind-scoured top, the
    // goblin scarps break rough, the crag country rears bare and jagged over talus.
    classes: [
      {
        name: 'alpine_meadow',
        upto: 0.305,
        biome: 'grassland',
        relief_scale: 0.6,
        height_bias: 0,
        roughness_scale: 0.7,
      }, // gentle open flower meadows (~13%)
      { name: 'pine_belt', upto: 0.389, biome: 'taiga', relief_scale: 0.9, height_bias: 2, roughness_scale: 1.0 }, // rolling wind-bent conifer belts (~13%)
      { name: 'highland', upto: 0.596 }, // NO PIN — dominant (~40%), the mixed climate fabric (identity)
      { name: 'wind_plateau', upto: 0.658, biome: 'desert', relief_scale: 1.1, height_bias: 10, roughness_scale: 0.6 }, // RAISED ochre tableland, smooth scoured top (~12%)
      {
        name: 'goblin_scarp',
        upto: 0.709,
        biome: 'scorched_badlands',
        relief_scale: 1.3,
        height_bias: 4,
        roughness_scale: 1.5,
      }, // broken sun-baked scarp country (~8%)
      { name: 'crag_scree', upto: 1.01, biome: 'alpine', relief_scale: 1.5, height_bias: 10, roughness_scale: 1.5 }, // bare jagged crests + talus (~14%)
    ],
  }

  // --- STRUCTURE POOL OVERRIDES (REGISTRY-name keys — the live decorator hook) -------------------
  // alpine has NO BIOME_SCHEMATICS row ⇒ overrides-only (the everest idiom): granite/alpine boulders =
  // the scree fields. desert's base row already carries DESERT_BIG_ROCK; sandstone slabs join it on the
  // plateau. grassland meadows get lonely granite erratics.
  base.structure_pool_overrides = {
    alpine: ['pool_rocks_alpine', 'pool_rocks_granite'],
    desert: ['pool_rocks_sandstone'],
    grassland: ['pool_rocks_granite'],
  }

  // --- TREE SPECIES (REGISTRY-name keys; wind-shaped rosters) -------------------------------------
  // taiga keeps DEFAULT's pine_cathedral/spruce (the pine belt); alpine keeps DEFAULT's sparse
  // spruce/snag (krummholz on the scree). Meadows drop the savanna acacia; the plateau grows only
  // wind-blasted snags; the scarp is bare (BIOME_SCHEMATICS scorched tree_one_in 0 ⇒ treeless already).
  base.tree_species = {
    ...base.tree_species,
    grassland: [
      { species: 'oak_broadleaf', weight: 3 },
      { species: 'birch_slim', weight: 1 },
    ],
    desert: [{ species: 'dead_snag', weight: 1 }],
  }

  // --- DECORATION (open, windswept — sparse stands, rocky ground, moor sprites) -------------------
  base.decoration = {
    ...base.decoration,
    tree_grove_one_in: 4, // (DEFAULT 3) sparser stands — an open windswept land
    rock_grove_one_in: 5, // (DEFAULT 6) rockier ground (scree/erratics are the world's texture)
    // No forest fern carpet (not a woodland world); meadow flowers stay. Opt-in highland accents:
    // alpine flowers + lichen on the heights, bush/dead branches/pebbles on the windy meadows.
    sprites: {
      fern: false,
      alpine_flower: true,
      lichen: true,
      bush: true,
      dead_branch: true,
      pebbles: true,
    },
  }

  // --- BIOME TABLE: REGISTRY names/ids (persisted, never renumbered). NO ocean/beach — a high inland
  // world (low ground pools into tarns; no sandy coast, no beach flatten). The four UNGATED members are
  // the no-pin highland fabric; the two GATED members are pin-only (see biome_selection above). --------
  base.biomes = [
    {
      id: 2,
      name: 'river',
      climate: { temperature: 0.5, humidity: 0.7, continentalness: 0.55, erosion: 0.7, pv: 0.02 },
      weight: 1.2,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
      tree_density: 0.06,
      grass_density: 0.5,
      structure_pools: [],
      music_bed: 'river',
    }, // highland streams — grassy banks, pebbly beds
    {
      id: 3,
      name: 'grassland',
      climate: { temperature: 0.55, humidity: 0.3, continentalness: 0.7, erosion: 0.8, pv: 0.5 },
      weight: 1.2,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.03,
      grass_density: 0.8,
      structure_pools: [],
      music_bed: 'grassland',
    }, // alpine meadows (the flower flats)
    {
      id: 7,
      name: 'taiga',
      climate: { temperature: 0.32, humidity: 0.45, continentalness: 0.7, erosion: 0.6, pv: 0.55 },
      weight: 1,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.2,
      grass_density: 0.35,
      structure_pools: ['pool_conifers'],
      music_bed: 'taiga',
    }, // pine belts on the cooler shoulders
    {
      id: 13,
      name: 'alpine',
      climate: { temperature: 0.3, humidity: 0.45, continentalness: 0.72, erosion: 0.15, pv: 0.85 },
      weight: 1.05,
      weirdness_gate: false,
      land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0.02,
      grass_density: 0.1,
      structure_pools: ['pool_rocks_alpine'],
      music_bed: 'alpine',
    }, // bare crests + scree
    // PIN-ONLY members (weirdness_gate:true ⇒ never in the climate candidate set; only region pins place them).
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
    }, // ochre wind-scoured plateau (mesa tiers via strata)
    {
      id: 11,
      name: 'scorched_badlands',
      climate: { temperature: 0.85, humidity: 0.15, continentalness: 0.7, erosion: 0.4, pv: 0.62 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'sand', subsurface: 'dirt', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0.02,
      structure_pools: ['pool_rocks_volcanic', 'pool_rocks_sandstone'],
      music_bed: 'desert',
    }, // sun-baked goblin scarp (the fire lean; SCORCHED_ROCK_LAVA glints via its base row)
  ]

  return base
}

/** The MISTRAL HEIGHTS world recipe (world 04) — pass to `create_engine({ world_config })`. */
export const MISTRAL_HEIGHTS_WORLD = build_mistral_heights()
