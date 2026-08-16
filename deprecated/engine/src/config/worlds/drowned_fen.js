// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WORLD 05 · DROWNED FEN (on-chain `05_drowned_fen`, biome `swamp`) — the black-water fen planet.
// Seed identity (seed/mainnet/05_drowned_fen/world.json): water+earth elements, "nocturnal bloom nodes —
// the best herbs surface only at night", herbalist-focus barge villages, the Flooded Nave. The engine
// identity: a FLAT drowned wetland hugging the waterline — open fen mosaic, reed-crowded marsh margins,
// tannin BLACK-WATER pools, willow-wet woods standing in the water, dark peat flats, and glow-shroom
// bloom glades (the nightcap herbalism nod).
//
// PRIOR ART: everglades.js (the swamp trailer world) proved every wetland lever used here — the flat
// waterline splines, the river/lake channel-mosaic hydrology, murky water optics, the sawgrass
// decoration block, and mangrove water-anchor pools. This recipe re-tunes those levers DARKER (tea-black
// water, peat palette) and adds the S-25 REGION LAYER the everglades deliberately does not carry (it is
// a no-drift control world — regions.test.js pins it region-free).
//
// ─── ARCHITECTURE (the S-25 fan-out pattern) ────────────────────────────────────────────────────────────
// A SPLINE-BASE world (massif OFF): the region layer's terrain knobs are now LIVE on the spline path (S-25+
// region-driven terrain — column_gen.raw_land_no_cirque; owner: every world uses the realism tech). Regions
// PIN the BIOME per column AND SHAPE terrain per zone (relief/height_bias/roughness on the classes below —
// here every knob is <1: a swamp stays LOW & WET); the base wetland TERRAIN mosaic (pools/channels/islets)
// still comes from the near-waterline splines + the hydrology recipe, now modulated per region.
//
// DECORATION-KEY LAW (surface_decorator.js:491): the decorator resolves the column biome via the MODULE
// registry, so `structure_pool_overrides` + `tree_species` keys are REGISTRY names (the paradise idiom);
// evocative names live on the region CLASSES. river/ocean have NO proc-tree roster ⇒ their mangrove
// pools fire as schematics (the everglades water-anchor path, live). dense_forest DOES have a roster
// (temperate oak/birch) ⇒ overridden below to swamp species so the willow wood never grows dry oaks.
//
// BLOOM GLADES: the swamp roster gains a low-weight `mushroom_giant` (emissive azure caps). The species
// was removed from the DEFAULT overworld rosters (the glow read wrong in a temperate spawn)
// with the explicit carve-out that it stays "where the glow belongs" — a dedicated swamp world's
// nocturnal blooms are exactly that (declared, not smuggled).

import { DEFAULT_WORLD_GEN_CONFIG } from '../world_gen_config.js'

/** @typedef {import('../world_gen_config.js').WorldGenConfig & { name: string, biome_pin: string }} NamedWorldConfig */

/**
 * Builds the drowned-fen recipe: a deep clone of the live DEFAULT (inherits every field this lane does
 * not tune, so it tracks the schema) + the black-water fen overrides + the world identity metadata.
 * @returns {NamedWorldConfig}
 */
function build_drowned_fen() {
  const base = /** @type {NamedWorldConfig} */ (structuredClone(DEFAULT_WORLD_GEN_CONFIG))

  base.name = 'drowned_fen'
  base.biome_pin = 'swamp'
  base.seed = 'drowned-fen-nave' // probed for the region-field percentiles below (a local probe script)
  base.version = 1 // drowned-fen recipe lineage v1 (config_hash differs from DEFAULT + every sibling)

  // --- CLIMATE FIELD FREQUENCIES (noise) ---------------------------------------------------------
  // The everglades humidity lever: a shorter period packs the humid (swamp-prone) belts tighter, so the
  // no-pin fen fabric mosaics swamp/river/ocean at a walkable grain. The rest stay DEFAULT — the wetland
  // READ is forced by terrain + hydrology + decoration, not climate.
  base.noise = {
    ...base.noise,
    humidity: { period: 1024, octaves: 6, spread: 2, gain: 0.5 }, // (was 1536) tighter humid belts
  }

  // --- TERRAIN SHAPING SPLINES (the flat drowned waterland) ---------------------------------------
  base.splines = {
    // Whole inland pinned TIGHT around the waterline (128), 123..131 — a horizontal world. Low
    // continentalness dips a few blocks under (shallow black lagoon edges, never deep ocean).
    continentalness_to_base: [
      [0.0, 123],
      [0.3, 127],
      [0.55, 129],
      [0.8, 130],
      [1.0, 131],
    ],
    // Relief CAPPED LOW everywhere: islets stay flat peat hummocks, never hills.
    erosion_to_amplitude: [
      [0.0, 13],
      [0.3, 8],
      [0.6, 5],
      [0.8, 4],
      [1.0, 3],
    ],
    // Gentle swing around 0: pv dips drop a hair below sea (shallow pools), rises lift emergent islets —
    // the drowned pool/hummock MOSAIC, with a deeper dip than the everglades for real black-water bodies.
    pv_to_relief: [
      [0.0, -0.42],
      [0.3, -0.12],
      [0.5, 0.05],
      [0.75, 0.2],
      [1.0, 0.36],
    ],
  }

  // --- 3D DENSITY / OVERHANG GATE (keep it FLAT) --------------------------------------------------
  base.density = {
    ...base.density,
    warp: { period: 240, octaves: 2, amp: 15 }, // (was amp 26) smooth horizontal wetland
    detail: { period: 132, octaves: 4, amp: 17 }, // (was amp 34) subtle only
    // Effectively shut: a fen is high-erosion, and pv ≥ 0.9 never coincides ⇒ zero undercuts/spikes.
    overhang: { erosion_max: 0.2, pv_min: 0.9, strength: 0.6 },
  }

  // --- HYDROLOGY (the drowned channel patchwork — wider/shallower than the everglades) ------------
  base.hydrology = {
    ...base.hydrology,
    // RIVERS: broad, slow, shallow bayous threaded densely. Spread keeps DEFAULT's max_step containment
    // clamp (the everglades' full-replace dropped it — declared as prior-art drift, not copied).
    river: {
      ...base.hydrology.river,
      crease: { period: 340, octaves: 3 }, // (was 560) denser channel net
      warp: { period: 520, octaves: 2, amp: 95 }, // sinuous bayou meander
      width: 0.36, // (was 0.12) broad slow channels
      depth: 5, // (was 11) shallow fen channels
      bank: 1, // (was 3) water at the land surface — drowned banks
      continentalness_min: 0.32, // channels reach the lagoon fringe
    },
    // LAKES: many small shallow black pools ponding every hollow.
    lake: {
      period: 190, // (was 320) more, smaller basins
      octaves: 2,
      threshold: 0.6, // (was 0.72) more candidate pool area
      erosion_min: 0.4, // more of the flat fen ponds
      pv_max: 0.45, // gentle flats pond too
      min_body_depth: 2, // shallow pools survive the puddle gate
    },
  }

  // --- WATER OPTICS (BLACK tannin tea — darker than the everglades' algae green) ------------------
  // Red survives longest in tannin water (brown-black tea); green/blue die fast; near-immediate
  // opacity — you cannot see into a black pool. Visual-only (never in the gen golden).
  base.water = {
    body_color: [0.045, 0.04, 0.025], // near-black peat tea
    shallow_color: [0.12, 0.1, 0.05], // dark amber margin
    sigma: [1.1, 1.6, 2.2], // red penetrates, green/blue die ⇒ dark amber-brown tint
    fade_start: 0.7, // opaque almost immediately
    tint_depth: 2.6,
    deep_floor: 0.1,
  }

  // --- TEXTURE IDENTITY (the PEAT / BLACK-WATER palette) ------------------------------------------
  // Per-family HSV recolor of the shared atlas (baked copy + LOD far-shell): dark fen sedge, near-black
  // bog timber, deep peat soil, tannin-stained water texture, grey silt.
  base.textures = {
    families: {
      grass: { hue: -18, sat: 0.7, val: 0.62 }, // dark fen sedge
      foliage: { hue: -14, sat: 0.75, val: 0.6 }, // shadowed wet canopy
      wood: { hue: -8, sat: 0.95, val: 0.45 }, // near-black bog timber
      dirt: { hue: -10, sat: 0.9, val: 0.55 }, // deep peat
      sand: { hue: -8, sat: 0.5, val: 0.75 }, // grey channel silt
      water: { hue: -40, sat: 1.2, val: 0.5 }, // tannin-stained water texture
    },
  }

  // --- SKY ISLANDS OFF (a grounded drowned fen) ---------------------------------------------------
  base.sky = { ...base.sky, enabled: false }

  // --- BIOME SELECTION: pin-only members gated out of climate placement ---------------------------
  // The no-pin `open_fen` band is an ocean/river/swamp climate mosaic. A humidity-only placement bias
  // + the swamp point pulled toward the field means (below) make SWAMP win the fabric (probe-measured:
  // registry points left river/mud dominant at 40%); river keeps the true pv≈0 channel valleys and
  // ocean the low-continentalness lagoons. dense_forest/void_marsh/grassland place ONLY via region pins.
  base.biome_selection = {
    ...base.biome_selection,
    climate_bias: { humidity: 0.2 },
    weirdness_esoteric_threshold: 1.0,
  }

  // --- S-25 SUB-BIOME REGION LAYER (world-as-planet) — six fen sub-biomes -------------------------
  // Terrain knobs LIVE on the classes (S-25+ region-driven terrain). Band edges at the MEASURED field
  // percentiles (probed locally, seed drowned-fen-nave: p13=0.312 p25≈0.385 p65≈0.564
  // p78≈0.637 p88≈0.703) — area split ≈ 13/12/40/13/10/12, the no-pin open fen widest, the black pools
  // the rare dramatic feature. blend 0.05 cross-fades borders. Pins name REGISTRY biomes.
  base.regions = {
    enabled: true,
    field: { period: 1500, octaves: 2 }, // regions span ~0.75-1.5 km
    warp: { period: 750, octaves: 2, amp: 300 }, // organic band pockets
    blend: 0.05,
    variance: { period: 230, octaves: 2 },
    // TERRAIN KNOBS (S-25+ region-driven terrain): a swamp is LOW & WET, so every relief_scale is <1 — the
    // region field carves channels/pools (sunken height_bias), raises hummock glades, and keeps the peat flats
    // dead-flat, giving a "channels/hummocks/dead forest/open marsh" morphology at a gentle scale.
    classes: [
      {
        name: 'willow_wood',
        upto: 0.312,
        biome: 'dense_forest',
        relief_scale: 0.5,
        height_bias: -1,
        roughness_scale: 0.7,
      }, // dense wet woods standing in the water (~13%)
      { name: 'marsh_margin', upto: 0.385, biome: 'river', relief_scale: 0.35, height_bias: -2, roughness_scale: 0.6 }, // reed channel margins at the waterline (~12%)
      { name: 'open_fen', upto: 0.564, relief_scale: 0.7, height_bias: 0, roughness_scale: 0.9 }, // NO PIN — dominant (~40%), the gentle wet swamp plain (identity)
      { name: 'peat_flat', upto: 0.637, biome: 'grassland', relief_scale: 0.3, height_bias: 1, roughness_scale: 0.5 }, // dead-flat dark peat, lonely snags (~13%)
      {
        name: 'black_pool',
        upto: 0.703,
        biome: 'void_marsh',
        relief_scale: 0.5,
        height_bias: -4,
        roughness_scale: 0.8,
      }, // sunken tannin black-water pools (~10%)
      { name: 'bloom_glade', upto: 1.01, biome: 'swamp', relief_scale: 0.8, height_bias: 2, roughness_scale: 1.0 }, // raised glow-shroom hummock glades (~12%)
    ],
  }

  // --- STRUCTURE POOL OVERRIDES (REGISTRY-name keys — all LIVE on this world) ---------------------
  // ocean/river have no BIOME_SCHEMATICS row and no proc roster ⇒ overrides-only water-anchor mangroves
  // root in the flooded columns (the everglades hero path). swamp adds mangroves onto its native pools;
  // void_marsh (no row) gets dead trees + mud mounds; grassland peat gets lonely dead stands.
  base.structure_pool_overrides = {
    ocean: ['pool_mangrove'],
    river: ['pool_mangrove'],
    swamp: ['pool_mangrove', 'pool_swamp_trees'],
    dense_forest: ['pool_swamp_trees', 'pool_mangrove'],
    void_marsh: ['pool_dead_trees', 'pool_mud_mounds'],
    grassland: ['pool_dead_trees'],
  }

  // --- TREE SPECIES (REGISTRY-name keys) ----------------------------------------------------------
  // swamp: buttress-dominant + drowned snags + the RARE emissive mushroom_giant (nocturnal bloom — see
  // the header declaration). dense_forest MUST drop its temperate oak/birch roster (willow-wet wood);
  // grassland peat grows only snags. river/ocean keep NO roster ⇒ the mangrove schematics fire instead.
  base.tree_species = {
    ...base.tree_species,
    swamp: [
      { species: 'swamp_buttress', weight: 4 },
      { species: 'dead_snag', weight: 2 },
      { species: 'mushroom_giant', weight: 1 },
    ],
    dense_forest: [
      { species: 'swamp_buttress', weight: 3 },
      { species: 'dead_snag', weight: 1 },
    ],
    grassland: [{ species: 'dead_snag', weight: 1 }],
  }

  // --- DECORATION (the reed sea, darker) ----------------------------------------------------------
  base.decoration = {
    ...base.decoration,
    tree_grove_one_in: 2, // (was 3) denser mangrove/willow clusters at the water edges
    reed_one_in: 1, // EVERY water-margin column grows a reed — the fen fringe
    shore_band: 4, // broad wet margin — reeds crowd the flats
    reed_min_grass: 0, // reeds fire on all shores regardless of biome
    tall_cluster_one_in: 2, // sedge patches across the flats
    forest_tuft_one_in: 2,
    flower_patch_one_in: 12, // a fen, not a prairie
    // Swamp accents: cattails on the shores, swamp weed + moss on the flats, toadstools under the
    // willow canopy (the herbalist ground-read), bushes. No temperate fern carpet.
    sprites: { fern: false, cattail: true, swamp_weed: true, moss_tuft: true, toadstool: true, bush: true },
  }

  // --- BIOME TABLE: REGISTRY names/ids. UNGATED fabric = ocean/river/swamp (the no-pin mosaic);
  // GATED pin-only = dense_forest/grassland/void_marsh. All beds are dark mud — no bright sand anywhere
  // (a black-water fen); the only sand is the river-channel silt, recolored grey. No beach ⇒ no flatten.
  base.biomes = [
    {
      id: 0,
      name: 'ocean',
      climate: { temperature: 0.6, humidity: 0.7, continentalness: 0.05, erosion: 0.85, pv: 0.3 },
      weight: 1.4,
      weirdness_gate: false,
      land: { surface: 'dirt', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: [],
      music_bed: 'ocean',
    }, // the drowned lagoon fringe — black mud beds, mangroves root here
    {
      id: 2,
      name: 'river',
      climate: { temperature: 0.6, humidity: 0.8, continentalness: 0.5, erosion: 0.85, pv: 0.02 },
      weight: 1.2,
      weirdness_gate: false,
      land: { surface: 'dirt', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
      tree_density: 0.06,
      grass_density: 0.5,
      structure_pools: ['pool_mangrove'],
      music_bed: 'river',
    }, // slow bayou channels — silt beds, reed margins
    {
      id: 6,
      name: 'swamp',
      // Pulled toward the FIELD MEANS (fields cluster at 0.5; pv folds low) so the sedge fabric wins
      // the mid-samples — the registry point (h 0.9 / ero 0.9) lost the fabric to river (probe-proven).
      climate: { temperature: 0.55, humidity: 0.85, continentalness: 0.58, erosion: 0.75, pv: 0.38 },
      weight: 1.4,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.12,
      grass_density: 0.75,
      structure_pools: ['pool_swamp_trees', 'pool_swamp_undergrowth', 'pool_mangrove'],
      music_bed: 'swamp',
    }, // the fen fabric — sedge carpet, buttress trees, blooms
    // PIN-ONLY members (weirdness_gate:true ⇒ region pins only).
    {
      id: 5,
      name: 'dense_forest',
      climate: { temperature: 0.55, humidity: 0.9, continentalness: 0.6, erosion: 0.85, pv: 0.4 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.3,
      grass_density: 0.5,
      structure_pools: ['pool_swamp_trees', 'pool_mangrove'],
      music_bed: 'swamp',
    }, // willow_wood — the dense wet canopy
    {
      id: 3,
      name: 'grassland',
      climate: { temperature: 0.55, humidity: 0.75, continentalness: 0.62, erosion: 0.9, pv: 0.45 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.02,
      grass_density: 0.6,
      structure_pools: ['pool_dead_trees'],
      music_bed: 'swamp',
    }, // peat_flat — open dark flats
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
    }, // black_pool — bare peat + still black water (the Flooded Nave mood)
  ]

  return base
}

/** The DROWNED FEN world recipe (world 05) — pass to `create_engine({ world_config })`. */
export const DROWNED_FEN_WORLD = build_drowned_fen()
