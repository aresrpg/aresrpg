// WORLD 09 · CORAL THRONE (on-chain `09_coral_throne`, biome `reef_city`) — the drowned-reef planet.
// Seed identity (seed/mainnet/09_coral_throne/world.json): water+air elements, "tide-gated access —
// cave mouths and the dungeon open at low tide", "fisher-alchemist hub — the drowned court holds
// audience below". The engine identity: a SUBMERGED REEF SHELF world — you wade a turquoise shallow
// between low isles: coral-garden shelf country, wide pale tide flats, lush isle crowns, rosy coral
// tower karst (the throne spires), and deep kelp channels cutting the shelf.
//
// PARADISE CONTRAST (both are warm-water worlds): paradise is a DRY white-sand atoll (beaches above
// the line); coral_throne is a DROWNED shelf — most ground sits 1-4 blocks UNDER clear water, land is
// the exception. The identity carrier is the rosy coral-rock recolor + the ocean-pinned coral gardens.
//
// ─── ARCHITECTURE (the S-25 fan-out pattern) ────────────────────────────────────────────────────────────
// A SPLINE-BASE world (massif OFF): the region layer's terrain knobs are LIVE on the spline path (S-25+
// region-driven terrain — column_gen.raw_land_no_cirque; owner: every world uses the realism tech). Regions
// PIN the BIOME and SHAPE terrain per zone (relief/height_bias/roughness on the classes below); the base TERRAIN comes from
// the shelf-hugging splines (a base curve that rides just under/over the waterline) + the overhang gate
// opened on the spire columns (mushrooming coral towers).
//
// DECORATION-KEY LAW (surface_decorator.js:491): `structure_pool_overrides` + `tree_species` keys are
// REGISTRY names (the paradise idiom); evocative names ride the region CLASSES. ocean/river/beach coral
// overrides ride the water-anchor schematic path (the everglades mangrove/paradise reef idiom, live);
// alpine has NO BIOME_SCHEMATICS row ⇒ its coral-boulder override fires at the fallback density.

import { DEFAULT_WORLD_GEN_CONFIG } from '../world_gen_config.js'

/** @typedef {import('../world_gen_config.js').WorldGenConfig & { name: string, biome_pin: string }} NamedWorldConfig */

/**
 * Builds the coral-throne recipe: a deep clone of the live DEFAULT (inherits every field this lane does
 * not tune, so it tracks the schema) + the drowned-reef overrides + the world identity metadata.
 * @returns {NamedWorldConfig}
 */
function build_coral_throne() {
  const base = /** @type {NamedWorldConfig} */ (structuredClone(DEFAULT_WORLD_GEN_CONFIG))

  base.name = 'coral_throne'
  base.biome_pin = 'reef_city'
  base.seed = 'coral-throne-tide' // probed for the region-field percentiles below (a local probe script)
  base.version = 1 // coral-throne recipe lineage v1 (config_hash differs from DEFAULT + every sibling)

  // --- CLIMATE FIELD FREQUENCIES (noise) ---------------------------------------------------------
  // Slightly short erosion ⇒ isle belts alternate with flats at a swimmable grain; weirdness a touch
  // short ⇒ the spire chains (pv ridges) pack into visible tower groups off the flats.
  base.noise = {
    ...base.noise,
    erosion: { period: 1200, octaves: 6, spread: 2, gain: 0.5 }, // (was 1024) tighter isle belts
    weirdness: { period: 560, octaves: 4, spread: 2, gain: 0.5 }, // (was 512) grouped spire chains
  }

  // --- TERRAIN SHAPING SPLINES (the drowned shelf) ------------------------------------------------
  base.splines = {
    // The hero curve: most of the mid-continentalness range sits 1-4 blocks UNDER the waterline (128)
    // — the wadeable reef shelf; only high-cont ground rises into low isles; low cont drops into real
    // channels. Land is the exception, the shelf is the rule.
    continentalness_to_base: [
      [0.0, 110],
      [0.2, 122],
      [0.45, 126],
      [0.7, 130],
      [0.85, 136],
      [1.0, 146],
    ],
    // Isle amplitude: modest spire belts at low erosion, dead-flat shelf at high erosion.
    // Peak math: 146 + 62 = 208 ≪ the 382 cap.
    erosion_to_amplitude: [
      [0.0, 62],
      [0.3, 30],
      [0.6, 12],
      [0.8, 6],
      [1.0, 3],
    ],
    // Channel dips to tower spikes: flat shelf across the low/mid PV range, a hard late ramp — sudden
    // coral towers standing out of the shallow.
    pv_to_relief: [
      [0.0, -0.2],
      [0.35, 0.0],
      [0.6, 0.15],
      [0.8, 0.5],
      [1.0, 1.0],
    ],
  }

  // --- 3D DENSITY / OVERHANG GATE (mushrooming coral towers) --------------------------------------
  base.density = {
    ...base.density,
    warp: { period: 260, octaves: 3, amp: 30 }, // meandering tower faces
    detail: { period: 128, octaves: 4, amp: 32 }, // knobbly coral-growth detail
    // Gate opens on the spire columns ⇒ the towers undercut and cap outward (table-coral silhouettes).
    overhang: { erosion_max: 0.45, pv_min: 0.55, strength: 1.5 },
  }

  // --- HYDROLOGY (tide channels + tide pools) -----------------------------------------------------
  base.hydrology = {
    ...base.hydrology,
    river: {
      ...base.hydrology.river,
      crease: { period: 420, octaves: 3 }, // denser channel net across the shelf
      width: 0.3, // (was 0.12) broad tide channels
      depth: 6, // (was 11) shallow cuts
      bank: 1, // (was 3) water at the flat surface
      continentalness_min: 0.35, // channels reach the shelf fringe
    },
    lake: {
      ...base.hydrology.lake,
      period: 220, // many small basins
      threshold: 0.62, // more of the flats pond
      min_body_depth: 2, // tide pools survive the puddle gate
    },
  }

  // --- WATER OPTICS (vivid turquoise — the clearest warm water) -----------------------------------
  base.water = {
    body_color: [0.02, 0.12, 0.12], // deep turquoise-emerald body
    shallow_color: [0.16, 0.55, 0.5], // luminous lagoon shallows
    sigma: [0.8, 0.28, 0.3], // green+blue transmit ⇒ turquoise glow
    fade_start: 4.0, // very high clarity — you SEE the reef under you
    tint_depth: 11.0,
    deep_floor: 0.18,
  }

  // --- TEXTURE IDENTITY (the CORAL / PEARL palette) -----------------------------------------------
  // Per-family HSV recolor of the shared atlas (baked copy + LOD far-shell). The hero move is STONE →
  // rosy coral rock (the everest idiom: the near-grey base needs sat UP, not hue alone) — every spire,
  // strata face and boulder reads as reef skeleton. Pale pink-white coral sand carries the flats.
  base.textures = {
    families: {
      stone: { hue: 320, sat: 1.7, val: 0.95 }, // rosy coral rock (spires/boulders)
      sand: { hue: -12, sat: 0.45, val: 1.12 }, // pale pink-white coral sand
      grass: { hue: 15, sat: 1.15, val: 1.0 }, // lush warm isle green
      foliage: { hue: 18, sat: 1.2, val: 1.02 }, // vivid crown canopy
      dirt: { hue: 5, sat: 0.9, val: 0.85 }, // warm isle loam
      wood: { hue: 8, sat: 1.0, val: 0.9 }, // sun-bleached driftwood timber
    },
  }

  // --- SKY ISLANDS OFF (the drama is below the waterline) -----------------------------------------
  base.sky = { ...base.sky, enabled: false }

  // --- BIOME SELECTION: pin-only members gated out of climate placement ---------------------------
  // No climate bias: the shelf mosaic is cont-driven by design (ocean wins sub-sea via its cont pole,
  // beach the high-ero flats, tropical the dry mid-ground, river the pv fold-valleys). alpine places
  // ONLY via the pearl_spires pin.
  base.biome_selection = {
    ...base.biome_selection,
    weirdness_esoteric_threshold: 1.0,
  }

  // --- S-25 SUB-BIOME REGION LAYER (world-as-planet) — six reef sub-biomes -------------------------
  // Terrain knobs LIVE on the classes (S-25+ region-driven terrain). Band edges at the MEASURED field
  // percentiles (probed locally, seed coral-throne-tide: p13=0.305 p26=0.389 p66=0.575
  // p78=0.636 p88=0.701) — area split ≈ 13/13/40/12/10/13, the no-pin shelf widest, the pearl spires
  // the rare throne wonder. blend 0.05 cross-fades borders. Pins name REGISTRY biomes.
  base.regions = {
    enabled: true,
    field: { period: 1300, octaves: 2 }, // tighter regions — a busy reef mosaic
    warp: { period: 650, octaves: 2, amp: 260 }, // organic band pockets
    blend: 0.05,
    variance: { period: 220, octaves: 2 },
    // TERRAIN KNOBS (S-25+ region-driven terrain, own-settings): the region field now SHAPES the reef, not
    // just the biome — flats lie dead-flat under the tide, isle crowns rise dry, the pearl spires tower into
    // rough karst, the kelp channels sink. relief_scale scales the relief above the shelf base; height_bias
    // shifts a region relative to the 128 waterline; roughness_scale scales the coral-growth crag detail.
    classes: [
      { name: 'reef_gardens', upto: 0.305, biome: 'ocean', relief_scale: 0.6, height_bias: -1, roughness_scale: 0.8 }, // gentle coral-head shelf, just submerged (~13%)
      { name: 'tide_flats', upto: 0.389, biome: 'beach', relief_scale: 0.25, height_bias: 0, roughness_scale: 0.4 }, // dead-flat pale sand flats (~13%)
      { name: 'throne_shelf', upto: 0.575, relief_scale: 1.0, height_bias: 0, roughness_scale: 1.0 }, // NO PIN — dominant (~40%), the drowned shelf mosaic (identity baseline)
      { name: 'isle_crowns', upto: 0.636, biome: 'tropical', relief_scale: 1.3, height_bias: 5, roughness_scale: 1.1 }, // lush green isle tops rising DRY above the tide (~12%)
      { name: 'pearl_spires', upto: 0.701, biome: 'alpine', relief_scale: 1.6, height_bias: 3, roughness_scale: 1.5 }, // rosy coral tower karst — the throne wonder (~10%)
      { name: 'kelp_channels', upto: 1.01, biome: 'river', relief_scale: 0.7, height_bias: -6, roughness_scale: 0.9 }, // deep sunken tide-channel country (~13%)
    ],
  }

  // --- STRUCTURE POOL OVERRIDES (REGISTRY-name keys — the reef furniture) -------------------------
  // Coral schematics root in the flooded shelf columns (the paradise/everglades water-anchor path,
  // live); palms line the flats; tropical boulders + undergrowth crowd the crowns; the bare spires get
  // coral-rock boulders at their feet (alpine has no base row ⇒ override-only).
  base.structure_pool_overrides = {
    ocean: ['pool_coral'],
    river: ['pool_coral'],
    beach: ['pool_coral', 'pool_palms'],
    tropical: ['pool_rocks_tropical', 'pool_tropical_undergrowth'],
    alpine: ['pool_rocks_tropical'],
  }

  // --- TREE SPECIES (REGISTRY-name keys) ----------------------------------------------------------
  // Palms are the land silhouette: flats keep the beach palm+driftwood roster; crowns mix palms into
  // the jungle; channel banks grow lone palms. alpine is EMPTIED ⇒ bare coral towers.
  base.tree_species = {
    ...base.tree_species,
    beach: [
      { species: 'palm_curve', weight: 3 },
      { species: 'dead_snag', weight: 1 },
    ],
    tropical: [
      { species: 'jungle_giant', weight: 2 },
      { species: 'palm_curve', weight: 2 },
    ],
    river: [{ species: 'palm_curve', weight: 1 }],
    alpine: [],
  }

  // --- DECORATION (the living reef) ---------------------------------------------------------------
  base.decoration = {
    ...base.decoration,
    reed_one_in: 1, // every water margin grows a reed — the tide fringe
    shore_band: 3, // broad wet margin
    reed_min_grass: 0, // reeds on all shores regardless of biome
    // The full shoreline/underwater accent set: CORAL sprites on the submerged shelf, shells/stars/
    // driftwood/dune grass on the flats (beach accents), jungle plants + orchids on the crowns.
    sprites: {
      coral: true,
      seashell: true,
      starfish: true,
      driftwood: true,
      dune_grass: true,
      jungle_plant: true,
      orchid: true,
    },
  }

  // --- BIOME TABLE: REGISTRY names/ids. UNGATED fabric = ocean/beach/tropical/river (the no-pin
  // shelf mosaic — cont splits sea/flat/isle, pv the channels); GATED pin-only = alpine (the throne
  // spires). Beds are pale coral sand everywhere — the turquoise reads against white. ----------------
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
      structure_pools: ['pool_coral'],
      music_bed: 'ocean',
    }, // the shelf + channels — white sand under turquoise, coral heads
    {
      id: 1,
      name: 'beach',
      climate: { temperature: 0.62, humidity: 0.5, continentalness: 0.4, erosion: 0.85, pv: 0.2 },
      weight: 1.15,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'sand', underwater: 'sand', filler: 'stone' },
      tree_density: 0.02,
      grass_density: 0.08,
      structure_pools: ['pool_coral', 'pool_palms'],
      music_bed: 'beach',
    }, // tide flats — palms, shells, wide pale sand
    {
      id: 12,
      name: 'tropical',
      // The dry-ground fabric member, pulled ONTO the field mass (t 0.65 / pv 0.08 — the fold bottom-
      // loads pv and the registry t 0.85 paid a constant quarter-axis penalty) + a weight lead, so the
      // green shelf fabric beats river's pv-fold squat (probe-measured on this lane).
      climate: { temperature: 0.65, humidity: 0.6, continentalness: 0.65, erosion: 0.55, pv: 0.08 },
      weight: 1.45,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'sand', filler: 'stone' },
      tree_density: 0.2,
      grass_density: 0.7,
      structure_pools: ['pool_rocks_tropical', 'pool_tropical_undergrowth'],
      music_bed: 'tropical',
    }, // the green isle fabric
    {
      id: 2,
      name: 'river',
      climate: { temperature: 0.6, humidity: 0.65, continentalness: 0.5, erosion: 0.7, pv: 0.02 },
      weight: 1.0,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'sand', underwater: 'sand', filler: 'stone' },
      tree_density: 0.03,
      grass_density: 0.2,
      structure_pools: ['pool_coral'],
      music_bed: 'river',
    }, // kelp channels — deep cuts, coral walls
    // PIN-ONLY member (weirdness_gate:true ⇒ region pins only).
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
    }, // pearl_spires — bare rosy coral towers (the drowned court's throne)
  ]

  return base
}

/** The CORAL THRONE world recipe (world 09) — pass to `create_engine({ world_config })`. */
export const CORAL_THRONE_WORLD = build_coral_throne()
