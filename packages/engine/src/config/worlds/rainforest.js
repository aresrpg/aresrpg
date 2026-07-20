// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIVE WORLDS · RAINFOREST / VIETNAM (BIOMES_EXECUTION_PLAN §P3.1) — the karst limestone world.
//
// Visual north star ("realistic-but-fantastic", Ha Long Bay / Ninh Binh karst country): steep-
// walled limestone TOWERS rising abruptly from flat lush valley floors, threaded by jade rivers, a few
// towers taller than plausible as the fantasy note. This blob is a full, self-contained WorldGenConfig
// (a deep clone of the live DEFAULT recipe + karst overrides) so it drops straight into WORLD_CONFIGS
// and `create_engine({ world_config })`. CONFIG-ONLY lane — every lever below is a value the gen
// pipeline already consumes; no engine code is touched.
//
// THE KARST MACHINE (how the towers fall out of the existing gen, no new stage):
//   1. pv_to_relief stays ≈0 across a WIDE low/mid peaks-and-valleys range, then ramps HARD to 1.0 at
//      the high-pv ridge crossings → most of the map is a flat floor (relief≈0 ⇒ surface≈base) with
//      sudden isolated spikes exactly on the folded-ridge lines (derive_pv). That is the Ha Long
//      silhouette: flat water/jungle, then a vertical pillar. Towers cluster along ridge chains with
//      flat jungle between — NOT a uniform spike field.
//   2. erosion_to_amplitude keeps a TALL amplitude at low erosion that collapses fast → a tower only
//      grows where erosion is ALSO low. Since erosion and weirdness/pv are independent fields, towers
//      form only where low-erosion AND high-pv coincide (sparse, clustered); elsewhere the floor stays
//      flat. This is the "clusters, not uniform" requirement.
//   3. The ACTIVE overhang density gate (low erosion + high pv) is cranked so those same tower columns
//      grow undercutting, mushrooming limestone lips on their steep faces (domain-warped ridged detail)
//      — the drowned-karst overhang look. Warp amplitude is raised for sinuous, drainage-like walls.
//   4. STRATA banding is ON, slope-gated: only the steep tower faces quantize into horizontal
//      sedimentary bands (pale stone / mossy limestone / tan) — flat jungle floor keeps its cover.
//   5. Water optics retuned to a clear jade-green jungle river; sky islands OFF (a grounded karst world
//      has no floating Pandora masses).
//
// ⚠️ DECLARED GAP — BIOME PINNING IS NOT WIRED YET (same class as the hydrology-not-adopted gap the
// lane brief flagged). `biome_placer.js` reads the biome table + axis weights from `biome_registry.js`,
// NOT from `config.biomes` / `config.biome_selection`; and `noise` carries no climate bias/offset. So
// TODAY this world's terrain is fully karst (towers/overhangs/banding/jade rivers are all config-driven
// and live), but its BIOME LAYER is still the default registry placement: temperate-green valley floors
// + stone (alpine) tower surfaces, and the tropical `pool_jungle_giants` / `pool_tropical_undergrowth`
// decoration will NOT fire until placement adopts the table below. The `biomes` array here is already
// TRIMMED to the tropical family (the Phase-0 §3 "single-family placer table"), so the moment the placer
// reads `config.biomes`, this world pins to tropical jungle with ZERO further change here. Likewise
// `config.decoration` (grass/tree density) is not consumed by surface_decorator yet, and the saturated-
// green ground tint is render-side/global — both noted where set. See the lane report for the ask.

import { DEFAULT_WORLD_GEN_CONFIG } from '../world_gen_config.js'

/** @typedef {import('../world_gen_config.js').WorldGenConfig & { name: string, biome_pin: string }} NamedWorldConfig */

/**
 * Builds the rainforest recipe: a deep clone of the live DEFAULT (inherits every field this lane does
 * not tune, so it tracks the schema) + the karst overrides + the world identity metadata.
 * @returns {NamedWorldConfig}
 */
function build_rainforest() {
  const base = /** @type {NamedWorldConfig} */ (structuredClone(DEFAULT_WORLD_GEN_CONFIG))

  base.name = 'rainforest'
  base.biome_pin = 'tropical'
  base.seed = 'ares-rainforest-karst' // distinct climate/ridge layout for this world
  base.version = 2 // v2 — S-25 world-as-planet region layer (6 sub-biomes) layered onto the FROZEN v1 karst

  // --- CLIMATE FIELD FREQUENCIES (noise) -------------------------------------------------------
  // weirdness drives PV (the folded-ridge tower lines): a shorter period packs the karst ridges into
  // tighter, denser chains (Ha Long is a crowded tower field). erosion period sets the scale over
  // which tower-prone (low-erosion) belts alternate with flat (high-erosion) basins. NO bias term
  // exists on these fields (see DECLARED GAP) — frequency is the only climate lever available here.
  base.noise = {
    ...base.noise,
    weirdness: { period: 380, octaves: 4, spread: 2, gain: 0.5 }, // (was 512) MANY dense tower chains
    erosion: { period: 900, octaves: 6, spread: 2, gain: 0.5 }, // (was 1024) tower belts vs flat basins
  }

  // --- TERRAIN SHAPING SPLINES (the tower geometry) --------------------------------------------
  base.splines = {
    // v2 — Inland floor lifted ABOVE the sea (128) across almost the whole continentalness range so the
    // jungle is LAND, not drowned shelf: at v1 the [0,84]→[0.35,128] ramp put >40% of the map below the
    // waterline (measured), and the tropical/river/ocean UNDERWATER strata are SAND — that flooded sandy
    // bed (seen through the clear jade water) was half the "sand-dominant" read. Now only the deep-ocean
    // sliver (cont<0.1) sits below 128; valley floors land ~131-135 (flat, rivers thread just above the
    // waterline via hydrology carve). Towers still come from RELIEF, not a high base.
    continentalness_to_base: [
      [0.0, 122],
      [0.12, 130],
      [0.3, 134],
      [0.5, 138],
      [0.7, 142],
      [1.0, 146],
    ],
    // Low erosion → TALL amplitude with a WIDE tall shoulder (out to erosion ~0.4) so a larger fraction
    // of the map is tower-capable (a crowded field, not one lone massif); eroded ground still collapses
    // near-flat past 0.6. (Taller low end than DEFAULT for dramatic walls.)
    erosion_to_amplitude: [
      [0.0, 170],
      [0.18, 152],
      [0.4, 96],
      [0.58, 42],
      [0.78, 14],
      [1.0, 4],
    ],
    // THE KARST CURVE: relief ≈0 across a wide low/mid PV range (flat floors everywhere), then ramps up
    // from the PV ~0.7 knee to 1.0 at the ridge crossings — MANY ridge columns spike into towers while
    // the floors stay flat. This is what turns the map into "flat lush floor + a field of sudden
    // vertical pillars" instead of rolling hills.
    pv_to_relief: [
      [0.0, -0.12],
      [0.34, 0.0],
      [0.55, 0.07],
      [0.72, 0.34],
      [0.88, 0.72],
      [1.0, 1.0],
    ],
  }

  // --- 3D DENSITY / OVERHANG GATE (the undercutting limestone walls) ---------------------------
  base.density = {
    ...base.density,
    // Domain warp raised (amp 26→38, period 240→300) → sinuous, drainage-like tower ridgelines rather
    // than radially-symmetric bumps.
    warp: { period: 300, octaves: 2, amp: 38 },
    // Overhang detail: a touch taller (amp 34→42) for pronounced mushroom lips; period near DEFAULT so
    // the undercuts read as broad limestone notches, not high-frequency noise.
    detail: { period: 140, octaves: 4, amp: 42 },
    // Gate opens on more of the tower flanks (erosion_max 0.46→0.55, pv_min 0.46→0.40) and hits harder
    // (strength 1.35→1.9) → the steep faces genuinely undercut and mushroom. Bounded so silhouettes
    // stay coherent (max lift ≈ 1.9·42 ≈ 80 blocks, well inside the 384 world box).
    overhang: { erosion_max: 0.55, pv_min: 0.4, strength: 1.9 },
  }

  // --- STRATA BANDING (limestone sedimentary bands on the steep tower faces) -------------------
  // Slope-gated: only steep columns (tower walls) band; the flat jungle floor keeps its biome cover.
  // Broad bands + moss give WET tropical limestone. Overrides the exposed rock of steep columns.
  base.strata = {
    ...base.strata,
    enabled: true,
    band_height: 7, // broad, subtle bands (not thin ruler stripes)
    band_jitter: 4, // wavers the band boundary across a face so it reads geological, not painted
    slope_gate: 1.3, // v2 — was 0.5, which banded every gentle karst shoulder into bare rock (~25% of
    // the map read as stone, starving the jungle-floor coverage). Raised to 1.3 so ONLY the vertical
    // tower cliff faces expose limestone; the shoulders + tower TOPS keep jungle cover (Ha Long towers
    // are green-capped) — rock drops toward the "towers break through the canopy" read, not a rockfield.
    // v2 — the third band was 'sand' (tan) which painted a sandy stripe onto every tower face and fed
    // the sand-dominant read; swapped to 'dirt' (dark humus seam) so the limestone towers read pale
    // stone / moss / dark soil — geological variety with ZERO sand.
    palette: ['stone', 'mossy_stone', 'dirt'], // pale limestone / moss / dark humus seam
  }

  // --- WATER OPTICS (clear jade-green jungle rivers) -------------------------------------------
  // Green-dominant body + bright jade shallows; sigma keeps GREEN transmitting (low g extinction, higher
  // r/b) so the water reads as clear jungle jade rather than the DEFAULT open-ocean blue. Visual-only.
  base.water = {
    body_color: [0.04, 0.13, 0.11], // deep jade
    shallow_color: [0.15, 0.38, 0.3], // bright jade-green shallows
    sigma: [0.8, 0.35, 0.6], // r/b absorbed faster than g ⇒ green penetrates (clear jade)
    fade_start: 3.0, // see deeper (clear river)
    tint_depth: 7.0,
    deep_floor: 0.14,
  }

  // --- SKY ISLANDS OFF (grounded karst world) -------------------------------------------------
  // Keep the DEFAULT island SHAPE params (they satisfy the validator's band/reach constraints) and only
  // flip the switch — a Vietnam karst world has no floating Pandora masses.
  base.sky = { ...base.sky, enabled: false }

  // --- BIOME PIN (placement adopted — FIVE-WORLDS): the trimmed `biomes` table below restricts the
  // candidate set to the tropical family, and this PLACEMENT-ONLY climate_bias shifts the sample hot+humid
  // so tropical (temp/humid 0.85) wins nearest-fit on land (water biomes still win at low continentalness /
  // valley floors). Terrain shaping reads the raw climate — this moves biomes, not heights. Magnitude
  // TUNED (0.25): tropical-dominant land (~69%) while the jade RIVERS keep the valleys (~30%) and coastal
  // beaches survive at low continentalness — a 0.35 bias over-pinned to 100% tropical (drowned the rivers).
  base.biome_selection = {
    ...base.biome_selection,
    climate_bias: { temperature: 0.25, humidity: 0.25 },
    weirdness_esoteric_threshold: 1.0,
  }

  // --- TEXTURE IDENTITY (FIVE-WORLDS per-biome palette): saturated JADE jungle greens + DARK wet timber +
  // a faint green mossy tint on the limestone. HSV transforms on the shared recipe families — the atlas
  // layer indices are frozen, only the texel colours move; propagates to the LOD far-shell for free.
  base.textures = {
    families: {
      grass: { hue: 8, sat: 1.35, val: 0.9 }, // deep saturated jade jungle floor (v2: val 0.98→0.9, richer/darker)
      foliage: { hue: 6, sat: 1.4, val: 0.95 }, // vivid wet canopy
      wood: { hue: -6, sat: 1.1, val: 0.6 }, // dark rain-soaked jungle timber
      stone: { hue: 12, sat: 0.7, val: 1.0 }, // pale limestone with a green moss cast
      // v2 — dirt is now the jungle FLOOR/underwater/subsurface + the strata seam, so push it to a
      // rich DARK HUMUS (leaf-litter soil): warmer hue, more saturated, darker value than the temperate brown.
      dirt: { hue: -3, sat: 1.2, val: 0.68 },
    },
  }

  // --- BIOME TABLE: TROPICAL-FAMILY PIN (Phase-0 §3 single-family placer table) ----------------
  // CONSUMED BY PLACEMENT: create_gen_context threads this table into create_biome_context, so the
  // candidate set IS these members (a trimmed table = a pinned family). ids are persisted, never
  // renumbered. Land members: river (valleys) + tropical (jungle) win on land; ocean holds deep water.
  // v2 SAND KILL — the reject root cause. v1 had FOUR members, THREE of which paint SAND: ocean
  // (surface+underwater sand), beach (all sand), river (surface sand), and tropical's UNDERWATER was
  // also sand. On this karst world that put sand on the dry beaches AND on every submerged bed under
  // the clear jade water. A rainforest has NO beaches and a DARK-HUMUS floor, so:
  //   • BEACH is DROPPED entirely (removing it from the world table kills the biome's sand surface AND
  //     the world_gen beach-flattening — same lever the everest lane used to kill a biome's furniture).
  //   • RIVER keeps its jade valleys but the BANK reads grass (green), with sand only on the submerged
  //     channel bed (underwater:'sand') — i.e. a thin sand ribbon exactly at the waterline, the ONLY
  //     sand allowed. Lusher banks (tree/grass density up).
  //   • OCEAN's bed is dark riverbed muck (all dirt) so the deep-water sliver never shows sand.
  //   • TROPICAL's underwater flips sand→dirt: any jungle column dipping below the waterline shows a
  //     dark leaf-litter bottom, not a bright beach. Its land surface stays grass (the jade floor).
  // v2 — the table now carries the FOUR extra region-pin members (grassland/dense_forest/swamp/alpine, ids
  // REUSED from the registry so surface_decorator.get_biome_by_id + BIOME_SCHEMATICS resolve). All are
  // recoloured by the jade `textures` above (grass→jade, stone→pale mossy limestone) so they read as
  // TROPICAL sub-biomes, not their temperate namesakes. The DOMINANT canopy-jungle region carries NO pin
  // (biome_id −1 ⇒ the current climate placement is kept byte-for-byte — the identity-preservation lever).
  base.biomes = [
    {
      id: 0,
      name: 'ocean',
      climate: { temperature: 0.5, humidity: 0.6, continentalness: 0.05, erosion: 0.8, pv: 0.3 },
      weight: 1.4,
      weirdness_gate: false,
      land: { surface: 'dirt', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: [],
      music_bed: 'ocean',
    },
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
    },
    // The jungle. grass/tree density here document intent; live decoration reads biome_registry's
    // tropical (pool_jungle_giants + pool_tropical_undergrowth) once placement pins to this biome.
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
    },
    // The four extra members are PIN-ONLY: weirdness_gate:true makes them ESOTERIC, and biome_selection
    // below sets weirdness_esoteric_threshold:1.1 (> the |w−0.5|·2 max of 1) so they NEVER join the climate
    // candidate set — only the region pins (name→id, climate-independent) place them. This keeps the no-pin
    // canopy_jungle region's climate placement (ocean/river/tropical) BYTE-IDENTICAL to v1 (the identity).
    // glade (grassland id3) — open jade CLEARINGS: sparse broadleaf on a lush floor (the walkable light-gaps).
    {
      id: 3,
      name: 'glade',
      climate: { temperature: 0.8, humidity: 0.7, continentalness: 0.62, erosion: 0.72, pv: 0.4 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.05,
      grass_density: 0.85,
      structure_pools: ['pool_tropical_undergrowth'],
      music_bed: 'tropical',
    },
    // cloud_forest (dense_forest id5) — misty HIGHLAND jungle: the densest mossy canopy (walkable via the roster).
    {
      id: 5,
      name: 'cloud_forest',
      climate: { temperature: 0.75, humidity: 0.9, continentalness: 0.66, erosion: 0.7, pv: 0.55 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.3,
      grass_density: 0.6,
      structure_pools: ['pool_jungle_giants', 'pool_tropical_undergrowth'],
      music_bed: 'tropical',
    },
    // swamp_margin (swamp id6) — wet lowland margin: mangroves in the water + swamp canopy on the mud.
    {
      id: 6,
      name: 'swamp_margin',
      climate: { temperature: 0.7, humidity: 0.95, continentalness: 0.55, erosion: 0.85, pv: 0.28 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.12,
      grass_density: 0.6,
      structure_pools: ['pool_mangrove', 'pool_swamp_trees'],
      music_bed: 'swamp',
    },
    // karst_scarp (alpine id13) — bare PALE mossy-limestone tower faces / rocky falls (recoloured stone).
    {
      id: 13,
      name: 'karst_scarp',
      climate: { temperature: 0.7, humidity: 0.5, continentalness: 0.72, erosion: 0.2, pv: 0.82 },
      weight: 1,
      weirdness_gate: true,
      land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0.05,
      structure_pools: ['pool_rocks_tropical'],
      music_bed: 'tropical',
    },
  ]

  // --- S-25 SUB-BIOME REGION LAYER (world-as-planet) — ENRICH, do not replace (keep the karst
  // look) ------------------------------------------------------------------------------------------------
  // The karst TERRAIN is UNTOUCHED: on a classic-spline world the region terrain knobs are inert (only
  // massif_surface reads them), and raw_land is biome-independent + rainforest has no beach (no flatten) ⇒
  // the same-seed heightmap/towers/valleys are BYTE-IDENTICAL to v1 (the before/after proof). The region
  // layer only PINS the surface biome (blocks + decoration + tree density) per column. The DOMINANT band
  // `canopy_jungle` carries NO biome key ⇒ biome_id −1 ⇒ the current tropical climate placement is kept
  // EXACTLY (the beloved jungle is preserved in the widest band); the five narrower bands add the sub-biome
  // variety (rocky falls / cloud-forest / clearings / swamp margin / river banks). Band edges from the
  // MEASURED region-field percentiles (probed locally, seed ares-rainforest-karst), weighted so
  // canopy_jungle is by far the widest. Terrain knobs LIVE on the classes (S-25+ region-driven terrain).
  base.regions = {
    enabled: true,
    field: { period: 1400, octaves: 2 }, // regions span ~0.7-1.2 km (several within a short walk of spawn)
    warp: { period: 700, octaves: 2, amp: 280 }, // organic band pockets
    blend: 0.05,
    variance: { period: 220, octaves: 2 },
    // TERRAIN KNOBS (S-25+ region-driven terrain, own settings): the regions now SHAPE the karst — tower
    // country rears rough limestone, the cloud forest rides high shoulders, glades open flat and walkable,
    // the wetland margins sink to the waterline. Dominant jungle stays identity (the recipe IS the world).
    classes: [
      {
        name: 'karst_scarp',
        upto: 0.22,
        biome: 'karst_scarp',
        relief_scale: 1.6,
        height_bias: 8,
        roughness_scale: 1.5,
      }, // limestone TOWER country — steep + rough
      {
        name: 'cloud_forest',
        upto: 0.35,
        biome: 'cloud_forest',
        relief_scale: 1.2,
        height_bias: 6,
        roughness_scale: 1.1,
      }, // misty high shoulders
      { name: 'canopy_jungle', upto: 0.62 }, // NO PIN — dominant, keeps the current jungle (identity)
      { name: 'glade', upto: 0.73, biome: 'glade', relief_scale: 0.6, height_bias: 0, roughness_scale: 0.7 }, // open FLAT jade clearings (walkable light-gaps)
      {
        name: 'swamp_margin',
        upto: 0.86,
        biome: 'swamp_margin',
        relief_scale: 0.35,
        height_bias: -3,
        roughness_scale: 0.6,
      }, // mangrove margin at the waterline
      { name: 'river_bank', upto: 1.01, biome: 'river', relief_scale: 0.6, height_bias: -2, roughness_scale: 0.8 }, // low lush riparian banks
    ],
  }

  // --- STRUCTURE POOL OVERRIDES (per-pin decoration; the dominant jungle keeps registry decoration) -----
  base.structure_pool_overrides = {
    karst_scarp: ['pool_rocks_tropical'], // mossy tropical boulders on the bare limestone
    swamp_margin: ['pool_mangrove', 'pool_swamp_trees'], // mangroves root in the wet margin
    cloud_forest: ['pool_jungle_giants', 'pool_tropical_undergrowth'],
  }

  // --- TREE SPECIES (per-pin rosters; recoloured jade by the palette) ---------------------------
  // karst_scarp: EMPTY roster ⇒ bare limestone (else DEFAULT alpine grows cold spruce on the towers — the
  // everest far-mirror class). The jungle pins grow broadleaf/jungle giants; the glade a lone broadleaf.
  base.tree_species = {
    ...base.tree_species,
    karst_scarp: [],
    glade: [{ species: 'oak_broadleaf', weight: 1 }],
    cloud_forest: [
      { species: 'jungle_giant', weight: 2 },
      { species: 'oak_broadleaf', weight: 2 },
    ],
    swamp_margin: [
      { species: 'swamp_buttress', weight: 3 },
      { species: 'dead_snag', weight: 1 },
    ],
  }

  // --- DECORATION (jungle-dense clutter — decoration adoption LANDED, config.decoration is read now) ----
  // Denser tree groves + a lower FOREST threshold so more columns read as lush jungle floor (fern carpet).
  // Uses the ADOPTED key names (tree_grove_one_in, not the retired grove_one_in/tree_one_in).
  base.decoration = {
    ...base.decoration,
    tree_grove_one_in: 3, // one-third of 16×16 grove cells forest: 3× the inverse spacing frequency ⇒
    // ~one-third the tree anchors. Per-column tropical density + every tree species/visual stay unchanged.
    forest_tree_density: 0.1, // lower FOREST threshold so more columns read as jungle floor (fern)
    // VIVID-WORLD jungle accents (opt-in): broadleaf plants, orchids, young shoots, undergrowth bushes, toadstools.
    sprites: { jungle_plant: true, orchid: true, young_shoot: true, bush: true, toadstool: true },
  }

  return base
}

/** The RAINFOREST / VIETNAM karst world recipe — pass to `create_engine({ world_config })`. */
export const RAINFOREST_WORLD = build_rainforest()
