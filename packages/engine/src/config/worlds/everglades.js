// FIVE WORLDS · EVERGLADES / SWAMP (BIOMES_EXECUTION_PLAN §P3.4) — the "river of grass" wetland world.
//
// Visual north star ("realistic-but-fantastic", Florida Everglades sawgrass sea): a FLAT
// horizontal world hugging the waterline, its drama in the WATER PATCHWORK — a mosaic of shallow pools,
// slow wide channels and low grass islands — not in elevation. Mangroves stand rooted IN the water,
// dark tea-stained murk between them, sawgrass reeds crowding every shore, and a few otherworldly giant
// mushrooms scattered on the deep-swamp islands. This blob is a full, self-contained WorldGenConfig (a
// deep clone of the live DEFAULT recipe + swamp overrides) so it drops straight into WORLD_CONFIGS and
// `create_engine({ world_config })`. CONFIG-ONLY lane — every lever below is a value the gen/render
// pipeline already consumes; no engine code is touched.
//
// HOW THE WETLAND FALLS OUT OF THE EXISTING GEN (no new stage):
//   1. FLAT WATERLAND — continentalness_to_base pins the whole inland to ~1-4 blocks ABOVE sea level
//      (128), and erosion_to_amplitude is collapsed to near-flat (≈3-5 blocks in the high-erosion swamp
//      band). So the surface is a horizontal plain that only gently undulates around the waterline.
//   2. CHANNEL PATCHWORK — the mosaic is FREE from the SEA_LEVEL fill: `water_level` floors at 128
//      (hydrology.js), so every gentle pv-valley dip that falls below 128 pools with water while the pv
//      rises stay as grass islands. pv_to_relief is tuned to swing just ± a couple blocks around the
//      base → a dense mosaic of shallow pools + grass islets. WIDE, shallow, dense RIVERS (crease period
//      shortened, width cranked, depth shallowed, banks nearly flush) thread slow channels through it,
//      and frequent shallow pour-point LAKES (basin period shortened, threshold lowered, min body depth
//      dropped) pond the contained hollows. Together: the "river of grass".
//   3. MANGROVES IN THE WATER — structure_pool_overrides adds `pool_mangrove` to the swamp biome; those
//      schematics are flagged `water_anchor` (bundle water_anchor_pools), so the decorator's per-pick
//      waterline gate lets them root on a flooded seabed — base underwater, canopy above (the ONLY trees
//      that grow below the waterline). `pool_swamp_trees` fills the dry islands with cypress/swamp canopy,
//      and a scatter of `pool_giant_mushrooms` gives the fantastic note (see the RESTRAINT note below).
//   4. MURKY WATER — water optics retuned to a dark olive/brown-green tea-stained body with high murk
//      extinction and a short visibility fade → you cannot see far into the swamp water (render-only).
//   5. SAWGRASS SEA — the decoration block cranks reeds (every shore column, a broad shore band, gate
//      dropped so reeds fire regardless of biome) + tall grass clusters → a dense sawgrass carpet along
//      every waterline and across the flats. Sky islands OFF (a grounded wetland has no Pandora masses).
//
// ⚠️ DECLARED GAP — BIOME PINNING IS NOT WIRED YET (identical class to the rainforest/everest lanes).
// `biome_placer.js` reads the biome table + axis weights from `biome_registry.js`, NOT from `config.biomes`,
// and there is no climate bias/offset lever. So TODAY the TERRAIN read is fully global and live — the flat
// waterland, the channel/pool mosaic, murky water, and the sawgrass reeds (reed_min_grass=0 fires reeds on
// EVERY shore column, biome-independent) all render everywhere. But the MANGROVES + giant mushrooms are
// keyed to the `swamp` biome via structure_pool_overrides, so they only cluster where the DEFAULT registry
// happens to place swamp (humid + flat-erosion patches), not uniformly. The `biomes` array below is TRIMMED
// to the wetland family (Phase-0 §3 single-family placer table): the instant the placer reads `config.biomes`,
// this world pins to swamp with ZERO further change here. See the lane report for the pin ask.
//
// ⚠️ RESTRAINT NOTE (giant mushrooms) — the decorator picks a tree UNIFORMLY from the merged pool; there is
// no per-pool rarity weight yet. `pool_giant_mushrooms` (8 members) is kept a MINORITY of the land canopy by
// pairing it with `pool_swamp_trees` (11 members), and absolute sparsity comes from swamp's tree_one_in=16
// (BIOME_SCHEMATICS) — trees are sparse in a reed/water world, so the mushrooms that do appear read as
// scattered accents. TRUE single-pool rarity (a "1-in-30 of tree picks is a mushroom" weight) would need a
// decorator change (shared file) — declared, deferred, not blocking. Mangroves are the hero; mushrooms garnish.

import { DEFAULT_WORLD_GEN_CONFIG } from '../world_gen_config.js'

/** @typedef {import('../world_gen_config.js').WorldGenConfig & { name: string, biome_pin: string }} NamedWorldConfig */

/**
 * Builds the everglades recipe: a deep clone of the live DEFAULT (inherits every field this lane does not
 * tune, so it tracks the schema + stays byte-identical off the deliberate levers) + the swamp overrides +
 * the world identity metadata. Each override is a value the gen/render pipeline already consumes.
 * @returns {NamedWorldConfig}
 */
function build_everglades() {
  const base = /** @type {NamedWorldConfig} */ (structuredClone(DEFAULT_WORLD_GEN_CONFIG))

  base.name = 'everglades'
  base.biome_pin = 'swamp'
  base.seed = 'everglades-bayou' // distinct climate/channel layout for this world (own config identity)
  base.version = 1 // everglades recipe lineage v1 (config_hash differs from DEFAULT + every sibling)

  // --- CLIMATE FIELD FREQUENCIES (noise) -------------------------------------------------------
  // No bias term exists on the climate fields (see DECLARED GAP), so frequency is the only lever. A
  // slightly SHORTER humidity period packs the humid (swamp-prone) belts closer together; the rest stay
  // at DEFAULT — the wetland READ is forced by the terrain + hydrology + decoration below, not the climate.
  base.noise = {
    ...base.noise,
    humidity: { period: 1024, octaves: 6, spread: 2, gain: 0.5 }, // (was 1536) tighter humid belts
  }

  // --- TERRAIN SHAPING SPLINES (the flat waterland) --------------------------------------------
  base.splines = {
    // Whole inland pinned TIGHT around the waterline (128), 124..131: low continentalness dips only a few
    // blocks under (SHALLOW lagoon edges, not deep ocean), mid sits at the sea surface, high inland tops out
    // at just ~131 — a genuinely horizontal world (terrain hugging sea level ± a few blocks).
    continentalness_to_base: [
      [0.0, 124],
      [0.3, 127],
      [0.5, 129],
      [0.7, 130],
      [1.0, 131],
    ],
    // Relief amplitude CAPPED LOW everywhere (max ~14 even at the low-erosion end) so islands stay flat
    // grass islets, never hills; the high-erosion swamp band (erosion≈0.9) carries only ~3-4 blocks.
    erosion_to_amplitude: [
      [0.0, 14],
      [0.3, 9],
      [0.6, 6],
      [0.8, 4],
      [1.0, 3],
    ],
    // Gentle swing around 0 so relief adds only ± a couple blocks to the base: pv-valleys dip a hair below
    // the base (→ below sea ⇒ shallow pools) and pv-rises lift a hair above (→ emergent grass islets). This
    // fractures the flat plain into the shallow pool/grass MOSAIC ("river of grass"), sawgrass emerging.
    pv_to_relief: [
      [0.0, -0.4],
      [0.3, -0.12],
      [0.5, 0.04],
      [0.75, 0.18],
      [1.0, 0.35],
    ],
  }

  // --- 3D DENSITY / OVERHANG GATE (keep it FLAT — no spikes/overhangs) --------------------------
  base.density = {
    ...base.density,
    // Soften the domain warp + ridged detail so the near-flat surface stays smooth (no jagged micro-relief
    // poking through a wetland that should read horizontal).
    warp: { period: 240, octaves: 2, amp: 16 }, // (was amp 26)
    detail: { period: 132, octaves: 4, amp: 18 }, // (was amp 34) subtle only
    // Slam the overhang gate effectively SHUT: it opens only on low-erosion + high-pv columns; a swamp is
    // high-erosion, and requiring pv ≥ 0.9 too means the flat wetland never grows an undercut/spike. (The
    // gate stays valid; it just never coincides in this world's climate.)
    overhang: { erosion_max: 0.2, pv_min: 0.9, strength: 0.6 },
  }

  // --- HYDROLOGY (the channel patchwork — wide shallow rivers + frequent shallow lakes) ---------
  base.hydrology = {
    ...base.hydrology,
    // RIVERS: wide, slow, shallow channels threaded densely through the flats. Shorter crease period packs
    // MORE channels; width cranked (0.12→0.34) makes them broad; depth shallowed (11→5) + banks nearly
    // flush (bank 3→1) keeps the water high and the roots wet; continentalness_min lowered so channels
    // reach nearer the coast. Warp amp up for sinuous, drainage-like meander.
    river: {
      crease: { period: 360, octaves: 3 }, // (was 560) denser channel network
      warp: { period: 520, octaves: 2, amp: 90 }, // (was amp 70) sinuous meander
      width: 0.34, // (was 0.12) WIDE slow channels
      depth: 5, // (was 11) shallow swamp channels
      bank: 1, // (was 3) water sits near the land surface — wet banks, not dry gullies
      continentalness_min: 0.34, // (was 0.42) channels reach nearer the coast
      pv_max: 0.72,
    },
    // LAKES: frequent shallow pools ponding the contained hollows. Shorter basin period = MORE basins;
    // threshold lowered (0.72→0.62) = more area qualifies; erosion_min lowered so more flat swamp ponds;
    // min_body_depth dropped (4→2) so SHALLOW pools survive the puddle gate. (Real depressions above the
    // waterline pond here; sub-sea dips pool from the SEA_LEVEL fill regardless.)
    lake: {
      period: 200, // (was 320) more, smaller basins → a mosaic
      octaves: 2,
      threshold: 0.62, // (was 0.72) more candidate lake area
      erosion_min: 0.4, // (was 0.5) more of the flat swamp ponds
      pv_max: 0.45, // (was 0.3) valleys AND gentle flats pond
      min_body_depth: 2, // (was 4) shallow swamp pools survive
    },
  }

  // --- WATER OPTICS (murky GREEN swamp — design ruling 2026-07-07: water reads greenish) -----------
  // Green-dominant body (green ≫ red > blue) with HIGH murk extinction (red+blue absorbed fast ⇒ the
  // body reads algae-green) and a SHORT visibility fade → you cannot see far into the swamp. Visual-only.
  base.water = {
    body_color: [0.035, 0.09, 0.04], // dark algae-green deep body
    shallow_color: [0.1, 0.21, 0.09], // murky pond-green shallows
    sigma: [1.6, 0.9, 1.8], // red+blue absorbed fastest ⇒ green tint, short sight
    fade_start: 0.8, // water turns opaque almost immediately (murky)
    tint_depth: 3.0, // tint saturates fast — no seeing the bottom
    deep_floor: 0.12,
  }

  // --- TEXTURE IDENTITY (FIVE-WORLDS per-biome palette): a MURKY bayou — dark tannin greens, near-black
  // wet timber, tea-stained water texture. HSV transforms on the shared recipe families (atlas indices
  // frozen); propagates to the LOD far-shell so the horizon reads swampy, not temperate.
  base.textures = {
    families: {
      grass: { hue: -15, sat: 0.75, val: 0.72 }, // dark murky sawgrass green
      foliage: { hue: -12, sat: 0.8, val: 0.7 }, // deep shadowed swamp canopy
      wood: { hue: -8, sat: 1.0, val: 0.55 }, // near-black wet cypress / mangrove wood
      water: { hue: -35, sat: 1.15, val: 0.62 }, // tannin-stained brown-green water texture
    },
  }

  // --- SKY ISLANDS OFF (grounded wetland) ------------------------------------------------------
  // Keep the DEFAULT island SHAPE params (they satisfy the validator's band/reach constraints) and only
  // flip the switch — an Everglades world has no floating Pandora masses.
  base.sky = { ...base.sky, enabled: false }

  // --- STRUCTURE POOL OVERRIDES (mangroves in the water + swamp canopy + mushroom accents) ------
  // CONFIG-DRIVEN decorator hook (surface_decorator resolve_overrides): merges these bundle pools onto a
  // biome's tree/rock sets. pool_mangrove members are water_anchor (root in flooded columns).
  //
  // HERO-ELEMENT ROBUSTNESS (the placer gap, handled — not punted): mangroves are the hero, and they must
  // stand in the water NEAR THE PLAYABLE ORIGIN. But the swamp biome is not reliably placed there yet (the
  // placer reads biome_registry, not config.biomes — DECLARED GAP). This world, however, is BLANKETED by
  // ocean/river-classified water columns, so keying pool_mangrove to `ocean` + `river` too makes the
  // mangroves-in-water read appear GLOBALLY today (config-only, the live decorator hook, exactly as
  // designed) instead of hiding behind the gap. When placement adopts config.biomes and pins swamp, the
  // swamp entry already carries the full canopy. pool_swamp_trees = dry-island cypress/swamp canopy (also
  // keeps mushrooms a minority — see RESTRAINT NOTE); pool_giant_mushrooms = the fantastic accent (land
  // only — not water_anchor). (pool_mud_mounds omitted: swamp's BIOME_SCHEMATICS rock_one_in is 0 ⇒ inert.)
  base.structure_pool_overrides = {
    ocean: ['pool_mangrove'],
    river: ['pool_mangrove'],
    swamp: ['pool_mangrove', 'pool_swamp_trees', 'pool_giant_mushrooms'],
  }

  // --- DECORATION (the sawgrass sea) -----------------------------------------------------------
  // LIVE keys read by surface_decorator's resolve_deco (NB: the sibling lanes' grove_one_in/tree_one_in
  // overrides are STALE inert keys — the real names are tree_grove_one_in / reed_one_in / shore_band …).
  base.decoration = {
    ...base.decoration,
    tree_grove_one_in: 2, // (was 3) more tree groves → denser mangrove/cypress clusters at pool edges
    reed_one_in: 1, // (was 2) EVERY water-margin column grows a reed — a dense sawgrass fringe
    shore_band: 4, // (was 2) broaden the wet margin so reeds crowd the flats, not just the exact edge
    reed_min_grass: 0, // (was 0.15) reeds fire on ALL shores regardless of biome ⇒ global sawgrass sea
    tall_cluster_one_in: 2, // (was 5) more tall-grass patches across the flats
    tall_in_cluster_one_in: 1, // dense inside a cluster (unchanged)
    forest_tuft_one_in: 2, // (was 3) more short carpet grass mixed in
    flower_patch_one_in: 10, // (was 6) fewer flower meadows — a swamp, not a prairie
    // VIVID-WORLD swamp accents (opt-in): cattails on the shores, swamp weed + moss tufts on the flats, bushes.
    sprites: { cattail: true, swamp_weed: true, moss_tuft: true, bush: true },
  }

  // --- BIOME TABLE: SWAMP-FAMILY PIN (Phase-0 §3 single-family placer table) --------------------
  // ⚠️ NOT CONSUMED BY PLACEMENT YET (see DECLARED GAP): biome_placer reads biome_registry, not this.
  // Present so the instant placement adopts `config.biomes`, this world pins to swamp on land + water at
  // the pools/channels — no cross-biome patchwork. ids mirror the canonical registry (persisted, never
  // renumbered). swamp is the only land option ⇒ the pin. structure_pools mirror the registry swamp entry
  // (+ pool_mangrove) as documentation of intent; live decoration rides structure_pool_overrides above.
  base.biomes = [
    {
      id: 0,
      name: 'ocean',
      climate: { temperature: 0.6, humidity: 0.7, continentalness: 0.05, erosion: 0.85, pv: 0.3 },
      weight: 1.4,
      weirdness_gate: false,
      land: { surface: 'sand', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: [],
      music_bed: 'ocean',
    },
    {
      id: 2,
      name: 'river',
      climate: { temperature: 0.6, humidity: 0.8, continentalness: 0.5, erosion: 0.85, pv: 0.02 },
      weight: 1.2,
      weirdness_gate: false,
      land: { surface: 'dirt', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.06,
      grass_density: 0.5,
      structure_pools: ['pool_mangrove'],
      music_bed: 'river',
    },
    // The swamp. tree_density kept < DECO forest_tree_density (0.15) so the floor reads as a TALL-GRASS
    // sawgrass carpet (not a fern forest floor); grass_density lifted to emphasize the lush reed sea.
    {
      id: 6,
      name: 'swamp',
      climate: { temperature: 0.6, humidity: 0.9, continentalness: 0.58, erosion: 0.9, pv: 0.32 },
      weight: 1.4,
      weirdness_gate: false,
      land: { surface: 'grass', subsurface: 'dirt', underwater: 'dirt', filler: 'stone' },
      tree_density: 0.12,
      grass_density: 0.7,
      structure_pools: [
        'pool_swamp_trees',
        'pool_swamp_undergrowth',
        'pool_dead_trees',
        'pool_mangrove',
        'pool_giant_mushrooms',
      ],
      music_bed: 'swamp',
    },
  ]

  return base
}

/** The EVERGLADES / SWAMP world recipe — pass to `create_engine({ world_config })`. */
export const EVERGLADES_WORLD = build_everglades()
