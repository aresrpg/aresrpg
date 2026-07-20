// WORLD 11 · ROOTHEART (on-chain `11_rootheart`, biome `world_tree`) — the heartwood planet. Seed
// identity (seed/mainnet/11_rootheart/world.json): earth+water elements, "living-wood regrowth — the
// tree heals its own wounds; nodes regrow visibly", "lumberjack paradise inside one continent-sized
// tree; Aragog's brood nests in the roots". The engine identity: you LIVE AMONG THE ROOTS — long
// radiating root-vein ridges (the pv ridgelines read as surface roots), gnarled overhang arches, rock
// recolored BARK-BROWN so every cliff reads as heartwood, deep-moss ground, amber sap-water streams,
// giant-tree woods everywhere — and the dark root-maze hollows where Aragog's brood nests.
//
// ─── ARCHITECTURE (the S-25 fan-out pattern) ────────────────────────────────────────────────────────────
// A CLASSIC-SPLINE world (massif OFF): the region layer's terrain knobs WERE inert pre-2026-07-13 — now LIVE on the spline path (S-25+ region-driven terrain, column_gen.raw_land_no_cirque; see TERRAIN KNOBS on the classes) (the classes below carry them). The region layer PINS the BIOME per column; the ROOT read
// comes from LONG coherent pv ridgelines (mistral's long-weirdness lever), a cranked overhang gate
// (root arches), bark-banded strata on the steep root walls, and the bark-brown stone recolor.
//
// DECORATION-KEY LAW (surface_decorator.js:491): `structure_pool_overrides` + `tree_species` keys are
// REGISTRY names (the paradise idiom); evocative names ride the region CLASSES. crystal_hollows keeps
// NO proc roster ⇒ its pool_giant_mushrooms schematics fire (the pandora bloom-hollow law); river/ocean
// keep no roster ⇒ their mangrove pools root in the flooded banks (the drowned_fen water-anchor path).

import { DEFAULT_WORLD_GEN_CONFIG } from '../world_gen_config.js'

/** @typedef {import('../world_gen_config.js').WorldGenConfig & { name: string, biome_pin: string }} NamedWorldConfig */

/**
 * Builds the rootheart recipe: a deep clone of the live DEFAULT (inherits every field this lane does
 * not tune, so it tracks the schema) + the heartwood overrides + the world identity metadata.
 * @returns {NamedWorldConfig}
 */
function build_rootheart() {
  const base = /** @type {NamedWorldConfig} */ (structuredClone(DEFAULT_WORLD_GEN_CONFIG))

  base.name = 'rootheart'
  base.biome_pin = 'world_tree'
  base.seed = 'rootheart-aragog' // probed for the region-field percentiles below (a local probe script)
  base.version = 1 // rootheart recipe lineage v1 (config_hash differs from DEFAULT + every sibling)

  // --- CLIMATE FIELD FREQUENCIES (noise) ---------------------------------------------------------
  // weirdness LONG + fewer octaves ⇒ the PV folds run as LONG coherent ridgelines — the radiating
  // surface ROOTS you walk along; erosion long ⇒ broad root-wall belts vs mossy basins.
  base.noise = {
    ...base.noise,
    erosion: { period: 1450, octaves: 6, spread: 2, gain: 0.5 }, // (was 1024) broad root belts vs moss basins
    weirdness: { period: 900, octaves: 3, spread: 2, gain: 0.5 }, // (was 512/o4) long root-vein ridgelines
  }

  // --- TERRAIN SHAPING SPLINES (root-ridge country) -----------------------------------------------
  base.splines = {
    // Low-continentalness basins dip under the waterline (120 < 128) ⇒ amber meres pool between the
    // root systems; the inland rises to a 156 heartwood back.
    continentalness_to_base: [
      [0.0, 120],
      [0.2, 129],
      [0.45, 136],
      [0.7, 144],
      [1.0, 156],
    ],
    // Root-wall amplitude: tall at low erosion (the great surface roots), collapsing to soft moss
    // floors. Peak math: 156 + 110 = 266 ≪ the 382 cap.
    erosion_to_amplitude: [
      [0.0, 110],
      [0.25, 80],
      [0.5, 44],
      [0.75, 18],
      [1.0, 7],
    ],
    // Ridgeline curve: an early shoulder then a long ramp — roots you WALK ALONG (broad rounded backs),
    // with real glen dips between (the mistral ridge-walking idiom, root-scaled).
    pv_to_relief: [
      [0.0, -0.16],
      [0.25, 0.0],
      [0.5, 0.2],
      [0.7, 0.5],
      [0.88, 0.85],
      [1.0, 1.0],
    ],
  }

  // --- 3D DENSITY / OVERHANG GATE (gnarled root arches) -------------------------------------------
  base.density = {
    ...base.density,
    warp: { period: 240, octaves: 3, amp: 38 }, // strong meander — root knots and elbows
    detail: { period: 120, octaves: 4, amp: 34 }, // gnarled undercut detail
    // Gate opens wide on the ridge columns ⇒ the root walls undercut into ARCHES you pass beneath.
    overhang: { erosion_max: 0.5, pv_min: 0.45, strength: 1.8 },
  }

  // --- STRATA BANDING (bark banding on the steep root walls) --------------------------------------
  // Slope-gated: steep root faces band into humus/root-rock/humus rings — growth-ring geology; the
  // moss floors keep their cover. (stone is recolored bark-brown below — the banding reads as bark.)
  base.strata = {
    ...base.strata,
    enabled: true,
    band_height: 5,
    band_jitter: 4,
    slope_gate: 1.3, // vertical root walls only
    palette: ['dirt', 'stone', 'dirt'], // humus / bark-rock / humus
  }

  // --- WATER OPTICS (amber sap-water) -------------------------------------------------------------
  base.water = {
    body_color: [0.1, 0.055, 0.015], // deep amber sap
    shallow_color: [0.3, 0.18, 0.05], // warm honey margin
    sigma: [0.7, 1.3, 2.2], // red-amber transmits, blue dies
    fade_start: 1.6,
    tint_depth: 4.5,
    deep_floor: 0.18,
  }

  // --- TEXTURE IDENTITY (the HEARTWOOD palette — rock reads as wood) ------------------------------
  // Per-family HSV recolor of the shared atlas (baked copy + LOD far-shell). The hero move: STONE →
  // bark-brown (sat up + warm hue on the near-grey base) so every cliff, strata band and boulder reads
  // as the world-tree's body. Deep moss ground, auburn timber, dark humus, amber water.
  base.textures = {
    families: {
      stone: { hue: -22, sat: 1.5, val: 0.62 }, // bark-brown root-rock (the world-tree's body)
      grass: { hue: 12, sat: 1.25, val: 0.72 }, // deep moss carpet
      foliage: { hue: 10, sat: 1.15, val: 0.8 }, // deep green canopy
      wood: { hue: -6, sat: 1.35, val: 0.75 }, // rich auburn heartwood
      dirt: { hue: -4, sat: 1.15, val: 0.55 }, // dark living humus
      sand: { hue: -2, sat: 0.8, val: 0.8 }, // humus-tan mere shores
      water: { hue: -25, sat: 1.4, val: 0.85 }, // amber sap texture
    },
  }

  // --- SKY ISLANDS OFF (the wonder is the ground itself) ------------------------------------------
  base.sky = { ...base.sky, enabled: false }

  // --- BIOME SELECTION: pin-only members gated out of climate placement ---------------------------
  // No bias: temperate_forest's point sits ON the field means with a weight lead (the palewood-proven
  // fabric formula) ⇒ the root-forest IS the fabric; river keeps the pv-fold sap-streams and ocean the
  // low-cont amber meres. dense_forest/grassland/crystal_hollows/void_marsh place ONLY via region pins.
  base.biome_selection = {
    ...base.biome_selection,
    weirdness_esoteric_threshold: 1.0,
  }

  // --- S-25 SUB-BIOME REGION LAYER (world-as-planet) — six heartwood sub-biomes --------------------
  // Terrain knobs LIVE on the classes (S-25+ region-driven terrain). Band edges at the MEASURED field
  // percentiles (probed locally, seed rootheart-aragog: p13=0.307 p26=0.390 p66=0.586
  // p78=0.647 p88=0.703) — area split ≈ 13/13/40/12/10/13, the no-pin rootlands widest, the spore
  // hollows the rare wonder. blend 0.05 cross-fades borders. Pins name REGISTRY biomes.
  base.regions = {
    enabled: true,
    field: { period: 1400, octaves: 2 }, // regions span ~0.7-1.4 km
    warp: { period: 700, octaves: 2, amp: 280 }, // organic band pockets
    blend: 0.05,
    variance: { period: 230, octaves: 2 },
    // TERRAIN KNOBS (S-25+ region-driven terrain, own settings): heartwood morphology — the colossus
    // grove rides high rooted ground, sap streams braid low amber banks, moss glades open gentle, the
    // spore hollows sink into mushroom bowls, Aragog's root maze is a GNARLED broken tangle.
    classes: [
      {
        name: 'heart_grove',
        upto: 0.307,
        biome: 'dense_forest',
        relief_scale: 1.0,
        height_bias: 3,
        roughness_scale: 1.1,
      }, // the colossus wood on high roots (~13%)
      { name: 'amber_falls', upto: 0.39, biome: 'river', relief_scale: 0.55, height_bias: -3, roughness_scale: 0.8 }, // low braided sap-stream banks (~13%)
      { name: 'rootlands', upto: 0.586 }, // NO PIN — dominant (~40%), the root-forest fabric (identity)
      { name: 'moss_glade', upto: 0.647, biome: 'grassland', relief_scale: 0.55, height_bias: 1, roughness_scale: 0.6 }, // gentle open moss meadows (~12%)
      {
        name: 'spore_hollow',
        upto: 0.703,
        biome: 'crystal_hollows',
        relief_scale: 0.5,
        height_bias: -4,
        roughness_scale: 0.8,
      }, // sunken giant-mushroom bowls (~10%)
      { name: 'root_maze', upto: 1.01, biome: 'void_marsh', relief_scale: 0.9, height_bias: -2, roughness_scale: 1.3 }, // Aragog's gnarled broken tangle (~13%)
    ],
  }

  // --- STRUCTURE POOL OVERRIDES (REGISTRY-name keys) ----------------------------------------------
  // Mangroves ARE surface roots: they anchor in every flooded margin (river/ocean have no roster ⇒
  // the water-anchor schematic path fires — the drowned_fen hero move). Jungle giants join the woods
  // as heartwood colossi; the spore hollows grow schematic giant mushrooms; the root maze gets dead
  // tangle + mud mounds; moss glades lone mossy erratics.
  base.structure_pool_overrides = {
    ocean: ['pool_mangrove'],
    river: ['pool_mangrove'],
    temperate_forest: ['pool_broadleaf', 'pool_jungle_giants'],
    dense_forest: ['pool_jungle_giants', 'pool_broadleaf'],
    grassland: ['pool_rocks_granite'],
    crystal_hollows: ['pool_giant_mushrooms'],
    void_marsh: ['pool_dead_trees', 'pool_mud_mounds'],
  }

  // --- TREE SPECIES (REGISTRY-name keys) ----------------------------------------------------------
  // jungle_giant (the tallest species) is the heartwood colossus: dominant in the heart grove, woven
  // through the rootlands. Moss glades grow a lone oak. crystal_hollows deliberately keeps NO roster
  // (the schematic mushrooms must fire); river/ocean keep none (mangrove-root shores).
  base.tree_species = {
    ...base.tree_species,
    temperate_forest: [
      { species: 'oak_broadleaf', weight: 3 },
      { species: 'jungle_giant', weight: 2 },
    ],
    dense_forest: [
      { species: 'jungle_giant', weight: 4 },
      { species: 'oak_broadleaf', weight: 1 },
    ],
    grassland: [{ species: 'oak_broadleaf', weight: 1 }],
  }

  // --- DECORATION (the living forest floor) -------------------------------------------------------
  base.decoration = {
    ...base.decoration,
    tree_grove_one_in: 2, // (DEFAULT 3) near-continuous wood — the glade/maze regions supply openings
    forest_tree_density: 0.12, // more floors read as forest (fern carpet)
    // Root-floor accents: toadstools under the canopy (forest-floor opt-in), bushes in the glades.
    sprites: { toadstool: true, bush: true },
  }

  // --- BIOME TABLE: REGISTRY names/ids. UNGATED fabric = ocean/river/temperate_forest (the no-pin
  // rootlands mosaic — forest, sap streams, amber meres); GATED pin-only = dense_forest/grassland/
  // crystal_hollows/void_marsh. Beds are dark humus everywhere — amber water over black earth. -------
  base.biomes = [
    {
      id: 0,
      name: 'ocean',
      climate: { temperature: 0.5, humidity: 0.7, continentalness: 0.05, erosion: 0.8, pv: 0.3 },
      weight: 1.4,
      weirdness_gate: false,
      land: { surface: 'dirt', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: ['pool_mangrove'],
      music_bed: 'ocean',
    }, // amber meres — dark humus beds, mangrove roots wade in
    {
      id: 2,
      name: 'river',
      climate: { temperature: 0.5, humidity: 0.7, continentalness: 0.5, erosion: 0.7, pv: 0.02 },
      weight: 1.0,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
      tree_density: 0.06,
      grass_density: 0.5,
      structure_pools: ['pool_mangrove'],
      music_bed: 'river',
    }, // sap streams — mossy banks, root tangles at the waterline
    {
      id: 4,
      name: 'temperate_forest',
      // ON the field means + a weight lead (the palewood fabric formula) ⇒ the wood IS the fabric.
      climate: { temperature: 0.5, humidity: 0.55, continentalness: 0.6, erosion: 0.62, pv: 0.12 },
      weight: 1.45,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.2,
      grass_density: 0.6,
      structure_pools: ['pool_broadleaf', 'pool_jungle_giants'],
      music_bed: 'forest',
    }, // the rootlands fabric — mixed wood with heartwood colossi
    // PIN-ONLY members (weirdness_gate:true ⇒ region pins only).
    {
      id: 5,
      name: 'dense_forest',
      climate: { temperature: 0.48, humidity: 0.75, continentalness: 0.66, erosion: 0.68, pv: 0.4 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.34,
      grass_density: 0.55,
      structure_pools: ['pool_jungle_giants', 'pool_broadleaf'],
      music_bed: 'forest',
    }, // heart_grove — the closed colossus canopy
    {
      id: 3,
      name: 'grassland',
      climate: { temperature: 0.55, humidity: 0.5, continentalness: 0.65, erosion: 0.85, pv: 0.3 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.02,
      grass_density: 0.85,
      structure_pools: ['pool_rocks_granite'],
      music_bed: 'grassland',
    }, // moss_glade — open moss light-gaps, lone erratics
    {
      id: 14,
      name: 'crystal_hollows',
      climate: { temperature: 0.5, humidity: 0.6, continentalness: 0.7, erosion: 0.6, pv: 0.5 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.05,
      grass_density: 0.5,
      structure_pools: ['pool_giant_mushrooms'],
      music_bed: 'esoteric',
    }, // spore_hollow — giant mushrooms in the root shade
    {
      id: 16,
      name: 'void_marsh',
      climate: { temperature: 0.4, humidity: 0.9, continentalness: 0.55, erosion: 0.9, pv: 0.25 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'dirt', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.04,
      grass_density: 0.1,
      structure_pools: ['pool_dead_trees', 'pool_mud_mounds'],
      music_bed: 'esoteric',
    }, // root_maze — Aragog's bare dark tangle
  ]

  return base
}

/** The ROOTHEART world recipe (world 11) — pass to `create_engine({ world_config })`. */
export const ROOTHEART_WORLD = build_rootheart()
