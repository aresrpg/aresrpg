// WORLD 18 · ABYSSAL WEALD (on-chain `18_abyssal_weald`, biome `abyssal_forest`) — the lightless-forest
// planet. Seed identity (seed/mainnet/18_abyssal_weald/world.json): water+air elements, "anglerlight —
// bioluminescent lures in the deep weald; follow the wrong light and it follows back", co-op pack
// pressure, vitality lean. The engine identity: a DROWNED-DARK CLOSED CANOPY — near-black blue-green
// weald pressing in on all sides, ink-water pools in every hollow, gloom-pine stands, drowned root
// margins — and the ANGLERLIGHT: rare glow-shroom hollows whose azure caps are the only light.
// pandora_reach (canopy fabric) + drowned_fen (wet hollows) are the prior art, re-tuned LIGHTLESS.
//
// ANGLERLIGHT DECLARATION: the emissive `mushroom_giant` species + pool_giant_mushrooms schematics were
// removed from the DEFAULT overworld (the glow read wrong in a temperate spawn) with the
// explicit carve-out that they stay "where the glow belongs" — a lightless abyssal weald whose lore IS
// the lure-light is exactly that place (the drowned_fen/pandora precedent; declared, not smuggled).
//
// ─── ARCHITECTURE (the S-25 fan-out pattern) ────────────────────────────────────────────────────────────
// A CLASSIC-SPLINE world (massif OFF): the region layer's terrain knobs WERE inert pre-2026-07-13 — now LIVE on the spline path (S-25+ region-driven terrain, column_gen.raw_land_no_cirque; see TERRAIN KNOBS on the classes) (the classes below carry them). The region layer PINS the BIOME per column; the weald TERRAIN
// (rolling floor + real sunken hollows that flood into ink pools) comes from the splines + hydrology.
//
// DECORATION-KEY LAW (surface_decorator.js:491): `structure_pool_overrides` + `tree_species` keys are
// REGISTRY names (the paradise idiom); evocative names ride the region CLASSES. crystal_hollows carries
// NO proc roster ⇒ its pool_giant_mushrooms schematics ARE the anglerlights (the pandora bloom-hollow
// path, live); river/ocean keep no roster ⇒ their mangrove pools root in the flooded margins.

import { DEFAULT_WORLD_GEN_CONFIG } from '../world_gen_config.js'

/** @typedef {import('../world_gen_config.js').WorldGenConfig & { name: string, biome_pin: string }} NamedWorldConfig */

/**
 * Builds the abyssal-weald recipe: a deep clone of the live DEFAULT (inherits every field this lane
 * does not tune, so it tracks the schema) + the lightless-weald overrides + the world identity metadata.
 * @returns {NamedWorldConfig}
 */
function build_abyssal_weald() {
  const base = /** @type {NamedWorldConfig} */ (structuredClone(DEFAULT_WORLD_GEN_CONFIG))

  base.name = 'abyssal_weald'
  base.biome_pin = 'abyssal_forest'
  base.seed = 'abyssal-weald-anglerlight' // probed for the region-field percentiles below (probe_rdist method)
  base.version = 1 // abyssal-weald recipe lineage v1 (config_hash differs from DEFAULT + every sibling)

  // --- CLIMATE FIELD FREQUENCIES (noise) ---------------------------------------------------------
  // humidity shorter ⇒ the deep-wet belts (the weald fabric) pack tighter; weirdness a touch longer ⇒
  // broad soft folds, no spike chains (the weald presses, it doesn't stab).
  base.noise = {
    ...base.noise,
    humidity: { period: 1100, octaves: 6, spread: 2, gain: 0.5 }, // (was 1536) tight deep-wet belts
    weirdness: { period: 600, octaves: 4, spread: 2, gain: 0.5 }, // (was 512) soft broad folds
  }

  // --- TERRAIN SHAPING SPLINES (rolling weald floor + sunken ink hollows) -------------------------
  base.splines = {
    // Low rolling forest floor just above the waterline; only the deep-channel sliver dips under 128.
    continentalness_to_base: [
      [0.0, 121],
      [0.15, 130],
      [0.4, 135],
      [0.7, 140],
      [1.0, 146],
    ],
    // Modest amplitude — the weald rolls, never towers (the canopy does the towering).
    erosion_to_amplitude: [
      [0.0, 46],
      [0.3, 30],
      [0.55, 18],
      [0.8, 10],
      [1.0, 5],
    ],
    // A REAL deep negative dip: pv valleys sink well below the waterline ⇒ the drowned hollows the
    // ink pools flood; rises stay gentle wooded shoulders.
    pv_to_relief: [
      [0.0, -0.5],
      [0.3, -0.15],
      [0.55, 0.05],
      [0.8, 0.3],
      [1.0, 0.6],
    ],
  }

  // --- 3D DENSITY / OVERHANG GATE (soft-bodied land — the trees do the drama) ---------------------
  base.density = {
    ...base.density,
    warp: { period: 250, octaves: 2, amp: 20 },
    detail: { period: 140, octaves: 4, amp: 22 },
    overhang: { erosion_max: 0.35, pv_min: 0.6, strength: 0.9 }, // mild root-bank undercuts only
  }

  // --- HYDROLOGY (ink pools in every hollow + slow black brooks) ----------------------------------
  base.hydrology = {
    ...base.hydrology,
    river: {
      ...base.hydrology.river,
      crease: { period: 480, octaves: 3 }, // (was 560) a denser brook net
      warp: { period: 520, octaves: 2, amp: 80 },
      width: 0.2, // (was 0.12) broad slow water
      depth: 8, // (was 11) shallow dark brooks
      bank: 2, // (was 3) water near the land surface
      continentalness_min: 0.4,
    },
    lake: {
      period: 240, // (was 320) more, smaller basins — an ink pool in every hollow
      octaves: 2,
      threshold: 0.64, // (was 0.72) more candidate pool area
      erosion_min: 0.42,
      pv_max: 0.4,
      min_body_depth: 2, // shallow pools survive the puddle gate
    },
  }

  // --- WATER OPTICS (INK + the anglerlight — the money shot) --------------------------------------
  // Near-black body; the shallows carry an eerie cyan GLOW (the lure-light on the margins) and the
  // deep_floor residual is the highest in the fan-out — the light that follows back.
  base.water = {
    body_color: [0.008, 0.02, 0.03], // ink
    shallow_color: [0.05, 0.22, 0.26], // eerie cyan lure-glow margin
    sigma: [1.6, 0.9, 0.7], // red dies instantly; blue-green carries the glow
    fade_start: 1.4,
    tint_depth: 4.5,
    deep_floor: 0.22, // the residual glow — anglerlight in the deep
  }

  // --- TEXTURE IDENTITY (the ABYSSAL TEAL-BLACK palette) ------------------------------------------
  // Hue rotations push the living green toward deep-sea teal; everything darkens hard — the weald
  // reads as a forest at the bottom of a sea.
  base.textures = {
    families: {
      grass: { hue: 35, sat: 1.1, val: 0.5 }, // deep teal-green floor
      foliage: { hue: 40, sat: 1.15, val: 0.42 }, // near-black abyssal canopy
      wood: { hue: -10, sat: 0.7, val: 0.35 }, // ink-dark boles
      dirt: { sat: 0.8, val: 0.5 }, // dark wet loam
      sand: { hue: 10, sat: 0.5, val: 0.6 }, // dark silt margins
      water: { hue: 20, sat: 1.1, val: 0.5 }, // ink-stained water texture
    },
  }

  // --- SKY ISLANDS OFF (no sky reaches the weald floor) -------------------------------------------
  base.sky = { ...base.sky, enabled: false }

  // --- BIOME SELECTION: deep-wet fabric + pin-only members gated out ------------------------------
  // A humidity-only placement bias makes the closed-canopy members win the no-pin fabric (the fen
  // idiom); river keeps the true pv≈0 brook valleys and ocean the drowned channel floors.
  base.biome_selection = {
    ...base.biome_selection,
    climate_bias: { humidity: 0.25 }, // the pandora-proven bias magnitude — 0.2 left river stealing the fabric
    weirdness_esoteric_threshold: 1.0,
  }

  // --- S-25 SUB-BIOME REGION LAYER (world-as-planet) — six weald sub-biomes -----------------------
  // Terrain knobs LIVE on the classes (S-25+ region-driven terrain). Band edges at the MEASURED field
  // percentiles (probe_rdist method, seed abyssal-weald-anglerlight: p13=0.301 p25=0.366 p65=0.56
  // p78=0.627 p88=0.69) — area split ≈ 13/12/40/13/10/12, the no-pin deep weald widest, the angler
  // hollows the rare wonder-light. blend 0.05 cross-fades borders. Pins name REGISTRY biomes.
  base.regions = {
    enabled: true,
    field: { period: 1450, octaves: 2 }, // regions span ~0.7-1.45 km
    warp: { period: 720, octaves: 2, amp: 290 }, // organic band pockets
    blend: 0.05,
    variance: { period: 230, octaves: 2 },
    // TERRAIN KNOBS (region-driven terrain, own settings): drowned-dark morphology — the gloom
    // pines ride slightly higher stands, the mire sinks and root margins drop toward the ink water, the
    // anglerlight hollows SINK into bowl pockets (the lure light pools below you), glades open gentle.
    classes: [
      { name: 'gloom_pines', upto: 0.301, biome: 'taiga', relief_scale: 0.9, height_bias: 2, roughness_scale: 1.0 }, // black-pine cathedral stands (~13%)
      { name: 'mire_sink', upto: 0.366, biome: 'void_marsh', relief_scale: 0.4, height_bias: -4, roughness_scale: 0.6 }, // sunken drowned mud sinks (~12%)
      { name: 'deep_weald', upto: 0.56 }, // NO PIN — dominant (~40%), the closed-canopy fabric (identity)
      { name: 'weald_glade', upto: 0.627, biome: 'grassland', relief_scale: 0.6, height_bias: 1, roughness_scale: 0.7 }, // rare gentle teal light-gaps (~13%)
      {
        name: 'angler_hollow',
        upto: 0.69,
        biome: 'crystal_hollows',
        relief_scale: 0.5,
        height_bias: -5,
        roughness_scale: 0.8,
      }, // sunken anglerlight bowls (~10%)
      { name: 'drowned_root', upto: 1.01, biome: 'swamp', relief_scale: 0.45, height_bias: -2, roughness_scale: 0.7 }, // flooded root-margin country (~12%)
    ],
  }

  // --- STRUCTURE POOL OVERRIDES (REGISTRY-name keys) ----------------------------------------------
  // crystal_hollows (no row, no roster) ⇒ overrides-only pool_giant_mushrooms — the ANGLERLIGHT
  // (header declaration). ocean/river mangroves root in the flooded columns (the fen water-anchor
  // path); void_marsh gets drowned snags + mud mounds.
  base.structure_pool_overrides = {
    crystal_hollows: ['pool_giant_mushrooms'],
    ocean: ['pool_mangrove'],
    river: ['pool_mangrove'],
    swamp: ['pool_mangrove', 'pool_swamp_trees'],
    dense_forest: ['pool_swamp_trees'],
    void_marsh: ['pool_dead_trees', 'pool_mud_mounds'],
  }

  // --- TREE SPECIES (REGISTRY-name keys) ----------------------------------------------------------
  // The weald fabric grows GIANTS (closed canopy overhead); taiga keeps its cathedral pines (recolored
  // near-black — the gloom pines); the drowned roots mix buttress + snags + a RARE lure (mushroom_giant
  // at the lowest weight — the light that follows back; header declaration). crystal_hollows keeps NO
  // roster (the schematic anglerlights must fire); the glades grow a lone dark broadleaf.
  base.tree_species = {
    ...base.tree_species,
    dense_forest: [
      { species: 'jungle_giant', weight: 3 },
      { species: 'swamp_buttress', weight: 1 },
    ],
    tropical: [
      { species: 'jungle_giant', weight: 3 },
      { species: 'oak_broadleaf', weight: 1 },
    ],
    swamp: [
      { species: 'swamp_buttress', weight: 3 },
      { species: 'dead_snag', weight: 2 },
      { species: 'mushroom_giant', weight: 1 },
    ],
    grassland: [{ species: 'oak_broadleaf', weight: 1 }],
    river: [{ species: 'jungle_giant', weight: 1 }],
  }

  // --- DECORATION (pressing dark clutter — no meadow cheer) ---------------------------------------
  base.decoration = {
    ...base.decoration,
    tree_grove_one_in: 2, // (DEFAULT 3) near-continuous canopy; the glades supply the openings
    forest_tree_density: 0.12, // more columns read as forest floor
    flower_patch_one_in: 16, // almost no blooms — light is scarce
    // Dark-floor accents: toadstools + moss under the canopy, swamp weed + cattails on the ink
    // margins, jungle plants in the deep weald. No temperate tall grass.
    sprites: {
      tall_grass: false,
      toadstool: true,
      moss_tuft: true,
      swamp_weed: true,
      cattail: true,
      jungle_plant: true,
      bush: true,
    },
  }

  // --- BIOME TABLE: REGISTRY names/ids. UNGATED fabric = ocean/river/dense_forest/tropical (the
  // no-pin closed-canopy mosaic — the humidity bias lands the forest members while the channels stay
  // water); GATED pin-only = taiga/grassland/swamp/void_marsh/crystal_hollows. Dark beds everywhere —
  // no bright sand under ink water.
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
      structure_pools: [],
      music_bed: 'ocean',
    }, // the drowned channel floors — dark mud, mangrove roots
    {
      id: 2,
      name: 'river',
      // COLD + drier-than-the-bias (the pandora river lesson, probe-proven on THIS lane: a warm wet
      // river point stole the fabric — river 33% / dense_forest 2.9%). Cooled to 0.35/0.6 it keeps
      // only the true pv≈0 brook valleys.
      climate: { temperature: 0.35, humidity: 0.6, continentalness: 0.55, erosion: 0.7, pv: 0.02 },
      weight: 1.1,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.1,
      grass_density: 0.5,
      structure_pools: [],
      music_bed: 'river',
    }, // slow ink brooks — rooted margins
    {
      id: 5,
      name: 'dense_forest',
      // Pulled toward the FIELD MEANS so the closed canopy wins the biased mid-samples (the fen lesson;
      // h 0.8 sits exactly on the 0.25-biased humidity mean).
      climate: { temperature: 0.5, humidity: 0.8, continentalness: 0.58, erosion: 0.68, pv: 0.4 },
      weight: 1.4,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.32,
      grass_density: 0.6,
      structure_pools: ['pool_swamp_trees'],
      music_bed: 'forest',
    }, // the deep-weald fabric — the pressing canopy
    {
      id: 12,
      name: 'tropical',
      climate: { temperature: 0.65, humidity: 0.85, continentalness: 0.65, erosion: 0.75, pv: 0.48 },
      weight: 1.2,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.28,
      grass_density: 0.7,
      structure_pools: ['pool_jungle_giants', 'pool_tropical_undergrowth'],
      music_bed: 'tropical',
    }, // the wet giant-belt of the fabric
    // PIN-ONLY members (weirdness_gate:true ⇒ region pins only).
    {
      id: 7,
      name: 'taiga',
      climate: { temperature: 0.35, humidity: 0.6, continentalness: 0.68, erosion: 0.6, pv: 0.55 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.22,
      grass_density: 0.3,
      structure_pools: ['pool_conifers'],
      music_bed: 'taiga',
    }, // gloom_pines — black cathedral stands
    {
      id: 3,
      name: 'grassland',
      climate: { temperature: 0.5, humidity: 0.6, continentalness: 0.62, erosion: 0.8, pv: 0.45 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.03,
      grass_density: 0.7,
      structure_pools: [],
      music_bed: 'forest',
    }, // weald_glade — the rare teal light-gaps
    {
      id: 6,
      name: 'swamp',
      climate: { temperature: 0.55, humidity: 0.9, continentalness: 0.58, erosion: 0.85, pv: 0.35 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.12,
      grass_density: 0.6,
      structure_pools: ['pool_swamp_trees', 'pool_mangrove'],
      music_bed: 'swamp',
    }, // drowned_root — flooded buttress margins
    {
      id: 16,
      name: 'void_marsh',
      climate: { temperature: 0.4, humidity: 0.95, continentalness: 0.55, erosion: 0.95, pv: 0.25 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'dirt', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.03,
      grass_density: 0.08,
      structure_pools: ['pool_dead_trees', 'pool_mud_mounds'],
      music_bed: 'esoteric',
    }, // mire_sink — bare drowned mud
    {
      id: 14,
      name: 'crystal_hollows',
      climate: { temperature: 0.5, humidity: 0.75, continentalness: 0.7, erosion: 0.6, pv: 0.5 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.05,
      grass_density: 0.5,
      structure_pools: ['pool_giant_mushrooms'],
      music_bed: 'esoteric',
    }, // angler_hollow — the lure-light pockets
  ]

  return base
}

/** The ABYSSAL WEALD world recipe (world 18) — pass to `create_engine({ world_config })`. */
export const ABYSSAL_WEALD_WORLD = build_abyssal_weald()
