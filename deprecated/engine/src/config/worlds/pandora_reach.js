// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD 06 · PANDORA REACH (on-chain `06_pandora_reach`, biome `floating_islands`) — the lush alien-
// jungle flagship. Seed identity (seed/mainnet/06_pandora_reach/world.json): earth+air elements,
// "low-gravity island-drift — fall-and-drift between floating islands", "the mesmerizing flagship —
// vertical jungle archipelago". The engine identity: a bioluminescent-leaning DENSE ALIEN CANOPY
// (teal-cyan foliage over violet trunks) broken by open glades and glow-shroom hollows, karst-ish
// spire accents rising through the canopy, jade-cyan channels — and the Pandora FLOATING ISLANDS
// cranked ON overhead (this is the one fan-out world that keeps + amplifies the sky layer).
//
// VOCABULARY LAW (the lane brief): NO new blocks, NO new texture files — the alien read is composed
// ENTIRELY from existing biomes/blocks/species + the per-family HSV `textures` recolor (hue rotations
// carry the "alien": grass/foliage → teal-cyan, wood → dusk-violet, stone → cool teal-grey spires).
//
// ─── ARCHITECTURE (the S-25 fan-out pattern) ────────────────────────────────────────────────────────────
// A CLASSIC-SPLINE world (massif OFF): the region layer's terrain knobs WERE inert pre-2026-07-13 — now LIVE on the spline path (S-25+ region-driven terrain, column_gen.raw_land_no_cirque; see TERRAIN KNOBS on the classes) (the classes below carry them). The region layer PINS the BIOME per column; TERRAIN VARIETY
// comes from the tuned splines (rainforest-class spike curve, re-tuned: denser/steeper pillars with
// harder alien mushrooming via the overhang gate) + the cranked SKY-ISLAND field overhead.
//
// DECORATION-KEY LAW (surface_decorator.js:491): `structure_pool_overrides` + `tree_species` keys are
// REGISTRY names (the paradise idiom); evocative names ride the region CLASSES. crystal_hollows carries
// NO proc roster in DEFAULT ⇒ its schematic pool_giant_mushrooms fires (the glow-shroom hollows);
// alpine's inherited spruce roster is EMPTIED (bare alien spires — the everest far-mirror class).

import { DEFAULT_WORLD_GEN_CONFIG } from '../world_gen_config.js'

/** @typedef {import('../world_gen_config.js').WorldGenConfig & { name: string, biome_pin: string }} NamedWorldConfig */

/**
 * Builds the pandora-reach recipe: a deep clone of the live DEFAULT (inherits every field this lane
 * does not tune, so it tracks the schema) + the alien-jungle overrides + the world identity metadata.
 * @returns {NamedWorldConfig}
 */
function build_pandora_reach() {
  const base = /** @type {NamedWorldConfig} */ (structuredClone(DEFAULT_WORLD_GEN_CONFIG))

  base.name = 'pandora_reach'
  base.biome_pin = 'floating_islands'
  base.seed = 'pandora-reach-drift' // probed for the region-field percentiles below (a local probe script)
  base.version = 1 // pandora-reach recipe lineage v1 (config_hash differs from DEFAULT + every sibling)

  // --- CLIMATE FIELD FREQUENCIES (noise) ---------------------------------------------------------
  // weirdness SHORTER ⇒ the PV fold-ridges the jungle pillars spike along pack into dense chains (a
  // crowded vertical archipelago); erosion slightly shorter ⇒ tighter pillar-belt vs basin alternation.
  base.noise = {
    ...base.noise,
    weirdness: { period: 420, octaves: 4, spread: 2, gain: 0.5 }, // (was 512) dense pillar chains
    erosion: { period: 950, octaves: 6, spread: 2, gain: 0.5 }, // (was 1024) tight pillar belts
  }

  // --- TERRAIN SHAPING SPLINES (the vertical jungle) ----------------------------------------------
  base.splines = {
    // Jungle floor ABOVE the waterline across almost the whole range (the rainforest v2 lesson — a
    // drowned shelf reads as flooded sand); only the deep channel sliver (cont < ~0.12) dips under 128,
    // threading cyan water between the land masses ("archipelago" at ground level).
    continentalness_to_base: [
      [0.0, 120],
      [0.15, 131],
      [0.35, 135],
      [0.6, 139],
      [0.8, 143],
      [1.0, 147],
    ],
    // Pillar amplitude: tall at low erosion with a wide shoulder (a crowded spike field), collapsing to
    // a flat jungle floor. Peak math: 147 + 150 ≈ 297 ≪ the 382 cap (headroom under the sky band).
    erosion_to_amplitude: [
      [0.0, 150],
      [0.2, 120],
      [0.42, 70],
      [0.6, 34],
      [0.8, 12],
      [1.0, 5],
    ],
    // Spike curve, harder knee than the rainforest: flat floors across the low/mid PV range, then a
    // steep ramp — sudden vertical pillars through the canopy, walkable jungle between.
    pv_to_relief: [
      [0.0, -0.1],
      [0.35, 0.0],
      [0.6, 0.1],
      [0.78, 0.4],
      [0.9, 0.75],
      [1.0, 1.0],
    ],
  }

  // --- 3D DENSITY / OVERHANG GATE (alien mushrooming pillars) -------------------------------------
  base.density = {
    ...base.density,
    warp: { period: 290, octaves: 3, amp: 40 }, // strongly meandering pillar faces
    detail: { period: 135, octaves: 4, amp: 44 }, // pronounced undercut lips
    // The gate opens wide on the pillar columns and hits hard ⇒ genuinely mushrooming alien overhangs
    // (Hallelujah-adjacent silhouettes at ground level). Bounded (max lift ≈ 2.0·44 = 88 ≪ box).
    overhang: { erosion_max: 0.55, pv_min: 0.42, strength: 2.0 },
  }

  // --- STRATA BANDING (banded spire faces) --------------------------------------------------------
  // Slope-gated: only the steep pillar/spire faces band into stone/moss/dark seams (alien geology);
  // the jungle floor keeps its teal cover.
  base.strata = {
    ...base.strata,
    enabled: true,
    band_height: 8,
    band_jitter: 4,
    slope_gate: 1.35, // vertical faces only
    palette: ['stone', 'mossy_stone', 'dirt'], // cool spire rock / alien moss / dark seam
  }

  // --- SKY ISLANDS ON + CRANKED (the flagship layer — "fall-and-drift between floating islands") --
  // The one fan-out world that keeps the Pandora sky. Region rate ~2.6× DEFAULT + bigger archipelagos +
  // the cap band pulled a touch lower so the islands crowd the sky within sight of the canopy. Island
  // SHAPE params stay DEFAULT (they satisfy the validator's band/reach constraints: thickness 116 ≥
  // cap_radius_max·root_ratio_max = 114.4; region_size 768 > 2·reach).
  base.sky = {
    ...base.sky,
    enabled: true,
    region_rate: 0.34, // (was 0.13) most sky regions host an archipelago
    islands_min: 4, // (was 3)
    islands_max: 10, // (was 8) crowded drift-fields
    low_y: 286, // (was 300) caps reach a little lower — presence over the canopy
    high_y: 344, // (was 352) keeps the crown + thickness inside the box
  }

  // --- WATER OPTICS (clear alien cyan — glow-lagoon channels) -------------------------------------
  base.water = {
    body_color: [0.02, 0.1, 0.14], // deep cyan-teal body
    shallow_color: [0.1, 0.42, 0.5], // luminous cyan shallows
    sigma: [0.9, 0.3, 0.35], // green+blue transmit ⇒ cyan glow, red dies
    fade_start: 3.5, // high clarity
    tint_depth: 9.0,
    deep_floor: 0.16,
  }

  // --- TEXTURE IDENTITY (the ALIEN TEAL/VIOLET palette — the "no new textures" identity carrier) --
  // Per-family HSV recolor of the shared atlas (baked copy + LOD far-shell). Hue rotations do the alien
  // work: canopy/turf rotate green→teal-cyan, timber rotates brown→dusk-violet, the near-grey stone gets
  // its faint blue AMPLIFIED (the everest idiom: sat up, not hue alone) into cool teal-grey spires.
  base.textures = {
    families: {
      grass: { hue: 55, sat: 1.5, val: 0.95 }, // teal alien turf
      foliage: { hue: 60, sat: 1.55, val: 1.0 }, // luminous cyan-teal canopy
      wood: { hue: 250, sat: 0.9, val: 0.62 }, // dusk-violet trunks
      stone: { hue: 60, sat: 1.8, val: 0.85 }, // cool teal-grey spire rock
      dirt: { hue: 15, sat: 1.1, val: 0.7 }, // rich alien loam
      sand: { hue: 25, sat: 0.7, val: 1.05 }, // pale channel shores
    },
  }

  // --- BIOME SELECTION: tropical-lean fabric + pin-only members gated out -------------------------
  // The rainforest-PROVEN pair: a 0.25 placement-only hot+humid bias (0.35 over-pinned, drowned the
  // rivers) + a COOL river climate point (0.5/0.7 — a warmer river steals the whole fabric, probe-
  // measured on this lane: river 45% / tropical 5% at bias 0.2 with river at 0.6/0.75). With the pair,
  // tropical wins the biased mid-samples and river keeps only the true pv≈0 valleys. The gated members
  // place only via region pins.
  base.biome_selection = {
    ...base.biome_selection,
    climate_bias: { temperature: 0.25, humidity: 0.25 },
    weirdness_esoteric_threshold: 1.0,
  }

  // --- S-25 SUB-BIOME REGION LAYER (world-as-planet) — six alien sub-biomes ------------------------
  // Terrain knobs LIVE on the classes (S-25+ region-driven terrain). Band edges at the MEASURED field
  // percentiles (probed locally, seed pandora-reach-drift: p12≈0.292 p26≈0.375 p66≈0.561
  // p78≈0.627 p88≈0.692) — area split ≈ 12/14/40/12/10/12, the no-pin canopy widest, the glow hollows
  // the rare wonder. blend 0.05 cross-fades borders. Pins name REGISTRY biomes.
  base.regions = {
    enabled: true,
    field: { period: 1400, octaves: 2 }, // regions span ~0.7-1.4 km
    warp: { period: 700, octaves: 2, amp: 280 }, // organic band pockets
    blend: 0.05,
    variance: { period: 220, octaves: 2 },
    // TERRAIN KNOBS (S-25+ region-driven terrain, own settings): the alien jungle gains real vertical
    // drama — teal spire karst rears through the canopy, the mist jungle rides higher rougher ground,
    // glades open flat, glow-shroom hollows SINK into bowl country, channel banks dip to the water.
    classes: [
      { name: 'spire_karst', upto: 0.292, biome: 'alpine', relief_scale: 1.6, height_bias: 8, roughness_scale: 1.6 }, // teal-rock spires through the canopy (~12%)
      {
        name: 'mist_jungle',
        upto: 0.375,
        biome: 'dense_forest',
        relief_scale: 1.0,
        height_bias: 3,
        roughness_scale: 1.1,
      }, // deepest closed canopy on high ground (~14%)
      { name: 'canopy', upto: 0.561 }, // NO PIN — dominant (~40%), the tropical fabric (identity)
      { name: 'glade', upto: 0.627, biome: 'grassland', relief_scale: 0.6, height_bias: 0, roughness_scale: 0.7 }, // open FLAT teal light-gaps (~12%)
      {
        name: 'bloom_hollow',
        upto: 0.692,
        biome: 'crystal_hollows',
        relief_scale: 0.5,
        height_bias: -5,
        roughness_scale: 0.8,
      }, // sunken glow-shroom bowls (~10%)
      { name: 'drift_bank', upto: 1.01, biome: 'river', relief_scale: 0.6, height_bias: -3, roughness_scale: 0.8 }, // low lush channel banks (~12%)
    ],
  }

  // --- STRUCTURE POOL OVERRIDES (REGISTRY-name keys) ----------------------------------------------
  // crystal_hollows has NO BIOME_SCHEMATICS row and NO proc roster ⇒ overrides-only: the giant-mushroom
  // schematics ARE the bloom hollows (live, per the decoration-key law). alpine (no row) gets mossy
  // tropical boulders at the spire feet.
  base.structure_pool_overrides = {
    crystal_hollows: ['pool_giant_mushrooms'],
    alpine: ['pool_rocks_tropical'],
    dense_forest: ['pool_jungle_giants', 'pool_tropical_undergrowth'],
    tropical: ['pool_tropical_undergrowth'],
  }

  // --- TREE SPECIES (REGISTRY-name keys) ----------------------------------------------------------
  // tropical keeps DEFAULT's jungle_giant (recolored teal/violet). dense_forest drops its temperate
  // oak/birch for giant-dominant mist jungle; the glade grows a lone broadleaf; river banks a giant.
  // alpine is EMPTIED ⇒ bare spires (no spruce on alien rock — the everest far-mirror class).
  // crystal_hollows deliberately gets NO roster (the schematic mushrooms must fire).
  base.tree_species = {
    ...base.tree_species,
    alpine: [],
    dense_forest: [
      { species: 'jungle_giant', weight: 3 },
      { species: 'oak_broadleaf', weight: 1 },
    ],
    grassland: [{ species: 'oak_broadleaf', weight: 1 }],
    river: [{ species: 'jungle_giant', weight: 1 }],
  }

  // --- DECORATION (dense alien clutter) -----------------------------------------------------------
  base.decoration = {
    ...base.decoration,
    tree_grove_one_in: 2, // (was 3) near-continuous canopy; the glade/spire regions supply the openings
    forest_tree_density: 0.12, // more columns read as jungle floor (fern carpet)
    // Alien flora: jungle plants + orchids + young shoots under the canopy, toadstools in the shade,
    // bushes in the glades, coral fans in the cyan channels.
    sprites: { jungle_plant: true, orchid: true, young_shoot: true, toadstool: true, bush: true, coral: true },
  }

  // --- BIOME TABLE: REGISTRY names/ids. UNGATED fabric = ocean/river/tropical (the no-pin canopy
  // mosaic — the climate_bias pins land tropical while the channels stay water); GATED pin-only =
  // dense_forest/grassland/crystal_hollows/alpine. Jungle beds are dark loam (no bright sand under the
  // clear cyan water — the rainforest sand-kill lesson); sand survives only on ocean-channel floors.
  base.biomes = [
    {
      id: 0,
      name: 'ocean',
      climate: { temperature: 0.6, humidity: 0.7, continentalness: 0.05, erosion: 0.8, pv: 0.3 },
      weight: 1.4,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'sand', underwater: 'sand', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: [],
      music_bed: 'ocean',
    }, // the deep cyan channels between land masses
    {
      id: 2,
      name: 'river',
      climate: { temperature: 0.5, humidity: 0.7, continentalness: 0.55, erosion: 0.7, pv: 0.02 },
      weight: 1.2,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
      tree_density: 0.15,
      grass_density: 0.6,
      structure_pools: [],
      music_bed: 'river',
    }, // glow-channel banks — green margins, thin sand ribbon at the waterline only
    {
      id: 12,
      name: 'tropical',
      climate: { temperature: 0.85, humidity: 0.85, continentalness: 0.65, erosion: 0.75, pv: 0.48 },
      weight: 1.4,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.28,
      grass_density: 0.9,
      structure_pools: ['pool_jungle_giants', 'pool_tropical_undergrowth', 'pool_rocks_tropical'],
      music_bed: 'tropical',
    }, // the alien canopy fabric
    // PIN-ONLY members (weirdness_gate:true ⇒ region pins only).
    {
      id: 5,
      name: 'dense_forest',
      climate: { temperature: 0.8, humidity: 0.9, continentalness: 0.66, erosion: 0.7, pv: 0.52 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.32,
      grass_density: 0.7,
      structure_pools: ['pool_jungle_giants', 'pool_tropical_undergrowth'],
      music_bed: 'tropical',
    }, // mist_jungle — the closed canopy heart
    {
      id: 3,
      name: 'grassland',
      climate: { temperature: 0.8, humidity: 0.7, continentalness: 0.62, erosion: 0.78, pv: 0.45 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.04,
      grass_density: 0.85,
      structure_pools: [],
      music_bed: 'tropical',
    }, // glade — open teal light-gaps
    {
      id: 14,
      name: 'crystal_hollows',
      climate: { temperature: 0.6, humidity: 0.75, continentalness: 0.7, erosion: 0.6, pv: 0.5 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.06,
      grass_density: 0.6,
      structure_pools: ['pool_giant_mushrooms'],
      music_bed: 'esoteric',
    }, // bloom_hollow — the glow-shroom wonder pockets
    {
      id: 13,
      name: 'alpine',
      climate: { temperature: 0.55, humidity: 0.5, continentalness: 0.72, erosion: 0.15, pv: 0.85 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0.05,
      structure_pools: ['pool_rocks_tropical'],
      music_bed: 'esoteric',
    }, // spire_karst — bare teal-rock pillars
  ]

  return base
}

/** The PANDORA REACH world recipe (world 06) — pass to `create_engine({ world_config })`. */
export const PANDORA_REACH_WORLD = build_pandora_reach()
