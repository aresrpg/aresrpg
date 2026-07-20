// FIVE WORLDS · PARADISE BEACH (BIOMES_EXECUTION_PLAN §P3.5) — the white-sand / turquoise-lagoon world.
//
// Visual north star ("realistic-but-fantastic", Maldives / Seychelles postcard): a long, wide
// WHITE-SAND shelf sloping gently into a SHALLOW TURQUOISE lagoon, then a drop to rich blue; the world is
// MOSTLY COAST — island / atoll arcs, not an inland mass — with palms on the sand, a soft dune fringe
// behind, and NO mountains stealing the skyline. This blob is a full, self-contained WorldGenConfig (a
// deep clone of the live DEFAULT recipe + the beach overrides) so it drops straight into WORLD_CONFIGS and
// `create_engine({ world_config })`. CONFIG-ONLY lane — every lever below is a value the gen/render
// pipeline already consumes; no engine code is touched.
//
// THE POSTCARD MACHINE (how the coast falls out of the existing gen, no new stage):
//   1. COAST PROFILE (continentalness_to_base): the star. A DEEP-blue open-ocean tail, a GENTLE underwater
//      slope, a BROAD shallow-turquoise lagoon shelf just below the waterline, then the dry WHITE-SAND
//      beach band (the live beach-flatten polish snaps raw surfaces in [126,131] to a flat y=129, so the
//      sand reads as a clean flat shelf), then only a SOFT dune rise inland (+~18 at most — no peaks). The
//      beach-climate continentalness (≈0.32) is aligned to the dry-sand height so the `beach` biome (and
//      its palms) lands ON the sand once placement is config-driven.
//   2. ARCHIPELAGO (continentalness period shortened 4096→2000): the coast fragments into islands / atoll
//      arcs with turquoise lagoons between them instead of one continent — "mostly coast".
//   3. LOW RELIEF (erosion_to_amplitude crushed to ≈34→3, pv_to_relief gentled): flat-ish coast with soft
//      dune swells; the few low-erosion + high-pv columns lift ≈20-30 blocks into offshore palm ISLETS —
//      the fantastic note comes for free, in restraint (no aggressive overhang/spire that would fight the
//      clean postcard, per the lane brief).
//   4. TURQUOISE WATER OPTICS (render/water_material reads config.water): vivid turquoise shallows, high
//      clarity (low sigma, green transmits most), a LONG see-through fade, deep water shifting rich blue —
//      THE money shot of this biome. Visual-only (never in the gen golden).
//   5. SKY ISLANDS OFF — a grounded beach world has no floating Pandora masses.
//
// ⚠️ DECLARED GAPS (honest, not silently worked around — same class the sibling lanes flagged):
//  • BIOME PINNING NOT WIRED: `biome_placer.js` reads `biome_registry.js`, NOT `config.biomes`; the climate
//    fields carry no bias/offset (only period). So the `biomes` table below is INTENT/IDENTITY only, and
//    the biome LABELS (hence which columns read `beach` and grow palms) come from the DEFAULT registry
//    placement against these noise periods, NOT from this table. The coast SHAPE + turquoise water are
//    fully live today; the tropical-family pin is literal the moment placement adopts `config.biomes`.
//  • PALMS are ALREADY BASE-WIRED: `surface_decorator.BIOME_SCHEMATICS.beach.trees = ['PALM_TREE']`
//    (resolves PALM_TREE_G1..G4 == `pool_palms`) at a sparse tree_one_in=26. So NO `structure_pool_
//    overrides:{ beach:['pool_palms'] }` here — that would duplicate the same four palms for zero gain.
//  • REEF ACCENTS (coral) are BLOCKED CONFIG-ONLY: `pool_coral` (TROPICAL_CORAIL_G*) is category ROCK and
//    NOT in `water_anchor_pools`, and the decorator NEVER places rocks underwater (`!underwater` gate) —
//    while the one above-water coastal biome, `beach`, has `rock_one_in=0` in BIOME_SCHEMATICS, which
//    gates its rock branch off entirely. So a submerged lagoon reef cannot be placed from config alone.
//    STOP-AND-DECLARE (see the lane report): the minimal shared fix is either (a) flip
//    BIOME_SCHEMATICS.beach.rock_one_in 0→~18 and add `structure_pool_overrides:{ beach:['pool_coral'] }`
//    (reef-rock accents on the sand / at the waterline — shore placement), or (b) the true submerged reef:
//    add `pool_coral` to `water_anchor_pools` + recategorize it so it roots underwater. Left unwired here
//    rather than shipping inert config that silently does nothing.

import { DEFAULT_WORLD_GEN_CONFIG } from '../world_gen_config.js'

/** @typedef {import('../world_gen_config.js').WorldGenConfig & { name: string, biome_pin: string }} NamedWorldConfig */

/**
 * Builds the paradise recipe: a deep clone of the live DEFAULT (inherits every field this lane does not
 * tune, so it tracks the schema) + the beach overrides + the world identity metadata.
 * @returns {NamedWorldConfig}
 */
function build_paradise() {
  const base = /** @type {NamedWorldConfig} */ (structuredClone(DEFAULT_WORLD_GEN_CONFIG))

  base.name = 'paradise'
  base.biome_pin = 'beach'
  base.seed = 'ares-paradise-atoll' // seed-selected for a lagoon+beach+islet framing near the origin
  base.version = 2 // v2 — S-25 world-as-planet region layer (6 sub-biomes) over the FROZEN v1 coast profile

  // --- CLIMATE FIELD FREQUENCIES (noise) -------------------------------------------------------
  // Shorten ONLY continentalness (4096→2000): the ocean↔inland field is what breaks the coast into
  // ISLAND / ATOLL arcs — a shorter period packs more coastline + more turquoise lagoons near the origin
  // ("mostly coast"). Temperature/humidity/erosion/weirdness stay at DEFAULT periods (natural biome
  // variety + islet clustering). NO bias term exists on these fields (see DECLARED GAP) — period is the
  // only climate lever available here.
  base.noise = {
    ...base.noise,
    continentalness: { period: 2000, octaves: 6, spread: 2, gain: 0.5 }, // (was 4096) archipelago coast
  }

  // --- TERRAIN SHAPING SPLINES (the coast profile — the star) ----------------------------------
  base.splines = {
    // THE COAST PROFILE. continentalness → base height, straddling SEA_LEVEL (128):
    //   ≤0.15 → base <112  = DEEP blue open ocean (12-30+ blocks of water).
    //   0.15-0.28 → 112-125 = the GENTLE underwater slope into the lagoon.
    //   0.20-0.30 → 120-125 = the BROAD SHALLOW TURQUOISE lagoon shelf (2-8 blocks deep, sand seabed).
    //   ≈0.32 → ~128-129   = the dry WHITE-SAND beach band (aligned to the beach-climate continentalness
    //                        so the `beach` biome + palms land on the sand); the live beach-flatten polish
    //                        snaps raw surfaces in [126,131] to flat y=129 ⇒ a clean flat sand shelf.
    //   >0.4  → 132-147    = a SOFT dune / green-fringe rise (+18 at most — deliberately NO mountains).
    continentalness_to_base: [
      [0.0, 98],
      [0.1, 108],
      [0.2, 120],
      [0.28, 125],
      [0.34, 130],
      [0.48, 134],
      [0.68, 139],
      [0.85, 143],
      [1.0, 147],
    ],
    // Relief amplitude CRUSHED (DEFAULT tops ≈148): a postcard beach is flat. ≈34 at low erosion collapses
    // fast to ≈3 — soft dune swells at most; only a low-erosion + high-pv column lifts ≈20-30 blocks into an
    // offshore palm ISLET (the restrained fantastic note). No tall walls anywhere.
    erosion_to_amplitude: [
      [0.0, 34],
      [0.25, 22],
      [0.5, 12],
      [0.72, 6],
      [1.0, 3],
    ],
    // Gentle valley↔ridge separation: valleys dip (lagoon deeps / channels), ridges lift only softly
    // (dune crests / islets). Far tamer than DEFAULT's 1.0 peak so nothing spikes off the flat coast.
    pv_to_relief: [
      [0.0, -0.3],
      [0.18, 0.0],
      [0.45, 0.22],
      [0.72, 0.5],
      [1.0, 0.9],
    ],
  }

  // --- WATER OPTICS (vivid turquoise lagoon — THE money shot) ----------------------------------
  // Rich tropical-blue body + VIVID TURQUOISE shallows; LOW sigma (high clarity) with green the LEAST
  // extinguished channel so transmitted light through the shallow sand reads turquoise, and a LONG
  // see-through window (fade_start 4 / tint_depth 11) so the lagoon floor stays visible far out before the
  // water dives to rich blue. Visual-only (never in the gen golden). Read live by configure_water_optics().
  base.water = {
    body_color: [0.02, 0.13, 0.26], // deep water shifts to rich tropical blue
    shallow_color: [0.16, 0.52, 0.55], // vivid turquoise shallows (green-cyan)
    sigma: [0.55, 0.16, 0.26], // clear; green transmits most (turquoise glow), red dies fastest
    fade_start: 4.0, // high clarity — the lagoon floor stays see-through deeper
    tint_depth: 11.0, // long visibility fade before full body colour
    deep_floor: 0.14,
  }

  // --- TEXTURE IDENTITY (FIVE-WORLDS per-biome palette): a bright postcard — VIVID tropical greens on the
  // fringe + near-WHITE Maldives sand. HSV transforms on the shared recipe families (atlas indices frozen);
  // propagates to the LOD far-shell. Water hue stays with configure_water_optics (the turquoise lagoon).
  base.textures = {
    families: {
      grass: { hue: 10, sat: 1.4, val: 1.0 }, // vivid tropical-green fringe behind the sand
      foliage: { hue: 8, sat: 1.45, val: 0.98 }, // lush palm canopy
      sand: { sat: 0.5, val: 1.18 }, // brighter, desaturated → near-white Maldives sand
      stone: { sat: 0.55, val: 0.5 }, // v2 — dark volcanic rock for the black-rock POINT sub-biome (region-pinned)
    },
  }

  // --- DECORATION (postcard-sparse palm groves) -----------------------------------------------
  // Palm SPECIES + per-column density (tree_one_in=26) are base-wired in BIOME_SCHEMATICS.beach (a shared
  // file, untouched). The CLUMPING is config-driven here: thin the tree-grove field 1/3→1/5 so palms
  // arrive in a few open stands with bare white sand between them — "lean spacing, not a plantation" —
  // without touching the shared per-column density. (surface_decorator.resolve_deco consumes this.)
  base.decoration = {
    ...base.decoration,
    tree_grove_one_in: 5, // (was 3) fewer palm groves ⇒ open postcard beach
    // SPRITE SELECTION (no temperate tall grass on the beach): short DUNE grass + a few tropical
    // ground-cover blooms only — drop the chest-high temperate tall_grass, the forest fern, and marsh reeds.
    // The tuft carpet + flowers take the palette (pale sand-green dune grass). A disabled kind → the tuft.
    // coral: ON — vivid submerged reef fans on the lagoon sand floor (corals work well as sprites).
    sprites: {
      tall_grass: false,
      fern: false,
      reed: false,
      coral: true,
      // VIVID-WORLD beach accents (opt-in): dune grass + shells/starfish/driftwood on the white sand + a little inland green.
      dune_grass: true,
      seashell: true,
      starfish: true,
      driftwood: true,
      bush: true,
    },
  }

  // --- BIOME PIN (placement adopted): the trimmed `biomes` table pins the beach-coast family; a MILD
  // placement-only climate_bias lifts the inland (high-continentalness) columns into a TROPICAL-GREEN
  // FRINGE behind the beach, while the coast stays beach/sand and the channels stay river. Kept small
  // (0.12) deliberately — a bigger bias floods the coast with jungle and drowns the white-sand postcard.
  base.biome_selection = {
    ...base.biome_selection,
    climate_bias: { temperature: 0.12, humidity: 0.12 },
    weirdness_esoteric_threshold: 1.0,
  }

  // --- CORAL REEF (BOTH forms coexist): submerged SPRITE fans (config.decoration.sprites
  // .coral above) PLUS the schematic reef here. pool_coral is a WATER-ANCHOR rock pool whose wools remap to
  // MATTE coral CUBE blocks; the decorator's rock branch roots it only where real water is present above the
  // column (the fixed water_present test), so the reef lands on the submerged lagoon shelf, never dry sand.
  // v2 — + the volcanic-point rocks (alpine pin). beach coral kept (the submerged lagoon reef).
  base.structure_pool_overrides = { beach: ['pool_coral'], alpine: ['pool_rocks_volcanic'] }

  // --- SKY ISLANDS OFF (grounded beach world) -------------------------------------------------
  // Keep the DEFAULT island SHAPE params (they satisfy the validator's band/reach constraints) and only
  // flip the switch — a Maldives postcard has no floating Pandora masses over the lagoon.
  base.sky = { ...base.sky, enabled: false }

  // --- BIOME TABLE: BEACH / TROPICAL-FAMILY PIN (Phase-0 §3 single-family placer table) --------
  // ⚠️ NOT CONSUMED BY PLACEMENT YET (see DECLARED GAP): biome_placer reads biome_registry, not this.
  // Present so that the instant placement adopts `config.biomes`, this world pins to a beach-coast family
  // (turquoise ocean + white-sand shore + rivers + a green tropical fringe) with no cross-biome patchwork.
  // Values mirror the canonical registry entries (ids are persisted, never renumbered).
  base.biomes = [
    {
      id: 0,
      name: 'ocean',
      climate: { temperature: 0.6, humidity: 0.6, continentalness: 0.05, erosion: 0.8, pv: 0.3 },
      weight: 1.4,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'sand', underwater: 'sand', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: [],
      music_bed: 'ocean',
    },
    // The white-sand shore + its sparse palms (pool_palms via BIOME_SCHEMATICS.beach.trees, base-wired).
    {
      id: 1,
      name: 'beach',
      climate: { temperature: 0.65, humidity: 0.5, continentalness: 0.32, erosion: 0.85, pv: 0.45 },
      weight: 1.2,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'sand', underwater: 'sand', filler: 'stone' },
      tree_density: 0.02,
      grass_density: 0.05,
      structure_pools: ['pool_coral', 'pool_rocks_tropical'],
      music_bed: 'beach',
    },
    {
      id: 2,
      name: 'river',
      climate: { temperature: 0.6, humidity: 0.7, continentalness: 0.55, erosion: 0.7, pv: 0.02 },
      weight: 1.2,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
      tree_density: 0.05,
      grass_density: 0.3,
      structure_pools: [],
      music_bed: 'river',
    },
    // The green tropical fringe BEHIND the beach (light tropical pools). grass/tree density document intent;
    // live decoration reads biome_registry's tropical set once placement pins to this biome.
    {
      id: 12,
      name: 'tropical',
      climate: { temperature: 0.85, humidity: 0.8, continentalness: 0.6, erosion: 0.78, pv: 0.48 },
      weight: 1.3,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
      tree_density: 0.2,
      grass_density: 0.7,
      structure_pools: ['pool_jungle_giants', 'pool_tropical_undergrowth', 'pool_rocks_tropical'],
      music_bed: 'tropical',
    },
    // v2 REGION-PIN members (ids REUSED from the registry so the decorator resolves; recoloured by the
    // paradise palette: grass→vivid green, sand→near-white, stone→dark volcanic). PIN-ONLY:
    // weirdness_gate:true + biome_selection.weirdness_esoteric_threshold:1.1 (below) keep them OUT of the
    // climate candidate set, so the no-pin `coast` region's continentalness gradient (deep ocean → turquoise
    // lagoon → white sand → tropical fringe) stays BYTE-IDENTICAL to v1 — only the region pins place these.
    {
      id: 3,
      name: 'grassland',
      climate: { temperature: 0.82, humidity: 0.55, continentalness: 0.7, erosion: 0.8, pv: 0.5 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
      tree_density: 0.04,
      grass_density: 0.7,
      structure_pools: [],
      music_bed: 'grassland',
    }, // inland MEADOW
    {
      id: 10,
      name: 'desert',
      climate: { temperature: 0.9, humidity: 0.25, continentalness: 0.42, erosion: 0.85, pv: 0.45 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'sand', subsurface: 'sand', underwater: 'sand', filler: 'stone' },
      tree_density: 0.02,
      grass_density: 0.1,
      structure_pools: [],
      music_bed: 'beach',
    }, // pale DUNE backs
    {
      id: 13,
      name: 'alpine',
      climate: { temperature: 0.7, humidity: 0.3, continentalness: 0.8, erosion: 0.2, pv: 0.7 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0.05,
      structure_pools: ['pool_rocks_volcanic'],
      music_bed: 'beach',
    }, // black volcanic POINT
  ]

  // --- S-25 SUB-BIOME REGION LAYER (world-as-planet) — 6 coastal sub-biomes over the frozen coast --------
  // The continentalness COAST PROFILE (deep ocean → turquoise lagoon → white sand → dune → fringe) is the
  // star, so the DOMINANT band `coast` carries NO pin (biome_id −1) ⇒ that gorgeous gradient is preserved.
  // Five narrower bands add sub-biome variety the coast alone can't: a coral REEF flat, a black VOLCANIC
  // point, pale DUNE backs, an inland MEADOW, and lush PALM groves. Water level is hydrology-driven (biome-
  // independent) so the turquoise lagoon reads the same everywhere; a pin only changes the SEABED + emergent
  // surface block. Band edges from the MEASURED region-field percentiles (probed locally, seed
  // ares-paradise-atoll), `coast` centred + widest. Terrain knobs LIVE on the classes (S-25+ region-driven terrain).
  base.regions = {
    enabled: true,
    field: { period: 1500, octaves: 2 },
    warp: { period: 760, octaves: 2, amp: 300 },
    blend: 0.05,
    variance: { period: 240, octaves: 2 },
    // TERRAIN KNOBS (S-25+ region-driven terrain): real coastal morphology — the reef/lagoon flat lies dead-flat
    // under the tide, the volcanic point rises as a rough dramatic headland, the dune-back rolls, the meadow &
    // palm fringe sit gently raised. The dominant `coast` stays IDENTITY so the continentalness beach gradient
    // still reads (the region field textures it, never flattens the shoreline itself).
    classes: [
      { name: 'reef_flat', upto: 0.3, biome: 'beach', relief_scale: 0.3, height_bias: -3, roughness_scale: 0.4 }, // dead-flat coral lagoon / tidal flat (submerged)
      { name: 'volcanic_point', upto: 0.38, biome: 'alpine', relief_scale: 1.6, height_bias: 7, roughness_scale: 1.6 }, // dramatic rough black volcanic headland
      { name: 'coast', upto: 0.64, relief_scale: 1.0, height_bias: 0, roughness_scale: 1.0 }, // NO PIN — dominant (~48%), the continentalness coast gradient (identity)
      { name: 'dune_back', upto: 0.72, biome: 'desert', relief_scale: 1.1, height_bias: 3, roughness_scale: 0.7 }, // rolling wind-sculpted dune fields behind the beach
      { name: 'meadow', upto: 0.8, biome: 'grassland', relief_scale: 0.8, height_bias: 2, roughness_scale: 0.9 }, // gently raised inland tropical meadow
      { name: 'palm_grove', upto: 1.01, biome: 'tropical', relief_scale: 0.9, height_bias: 1, roughness_scale: 1.0 }, // lush palm-backed fringe
    ],
  }

  // --- TREE SPECIES (per-pin rosters) — alpine EMPTY (bare volcanic rock, no cold conifers) --------------
  base.tree_species = {
    ...base.tree_species,
    alpine: [],
    desert: [
      { species: 'palm_curve', weight: 1 },
      { species: 'dead_snag', weight: 1 },
    ], // rare dune palm / driftwood
    grassland: [{ species: 'palm_curve', weight: 1 }], // a lone palm in the meadow
  }

  return base
}

/** The PARADISE BEACH world recipe — pass to `create_engine({ world_config })`. */
export const PARADISE_WORLD = build_paradise()
