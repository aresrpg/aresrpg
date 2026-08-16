// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// EVEREST / ICE-AGE world recipe — v3 REWORK. v2 was rejected against a reference image:
// not realistic — mountains should read as way wider, indistinguishable as a single peak from
// ground level and only resolved by shape at LOD distance, and palm trees had no place in an
// everest biome alongside the wrong tree/bush mix. v2 failed four ways, all diagnosed at the pipeline level (config-only lane — every lever
// below is a value the gated gen stages already consume; no shared gen/render file is touched):
//
//   1. SCALE / FLAT PLAINS. v2's macro periods still let a whole massif fit one sightline, and its
//      erosion→amplitude FLOOR of 28 made high-erosion basins dead flat ⇒ "boulders on a white plain".
//      FIX: weirdness/erosion periods widened past the ±256 gen region (one massif ≈1200-1600 blocks,
//      never fully in frame), and the amplitude floor RAISED to 86 so even the flattest ground still
//      rolls — from any pose you stand ON a slope whose top or base you can't see at once.
//   2. ROUNDED DOMES. v2 read as smooth brown blobs. FIX: the broad pv shoulder lifts the whole massif
//      BODY (mass, not needles) while the always-on erosion carver (gen/carvers/erosion.js: ridged
//      crests + gully channels) chains sharp arêtes across the wide belt at zero config cost.
//   3. SNOW↔ROCK INVERSION. v2 faces read ~90% bare rock; the ref is ~80% snow with rock on steep
//      faces only. ROOT CAUSE: block_at evaluates STRATA before the snow stage (column_gen.js), so v2's
//      strata slope_gate 1.1 + grass_slope 1.0 stole every column steeper than 45° to stone before snow
//      could cap it. FIX: strata is DISABLED (the alpine STONE subsurface already reads as clean rock on
//      steep risers — strata's only remaining job — and the cold biome table means there is no temperate
//      dirt/grass to hide); grass_slope is raised to 2.2 so snow caps moderate-to-steep ground, leaving
//      bare rock only on genuinely near-vertical faces + wind-scoured crests. Snow is a TOP-voxel cap, so
//      the snow/rock read is a slope gradient for free: gentle staircases show snow risers, steep ones
//      expose the stone subsurface — exactly the ref's "snow shoulders, rock streaks on the steeps".
//   4. PALMS IN AN ICE AGE. surface_decorator.BIOME_SCHEMATICS maps 'beach' → PALM_TREE by biome NAME
//      (module const, NOT config.biomes.structure_pools). v2 kept 'beach' in its table, so every coastal
//      column grew palms. FIX: 'beach' is REMOVED from the biome table entirely — the placer DOES consume
//      config.biomes (v2's "gap D" note was stale), so a cold-only table pins the world 100% cold and
//      makes palms impossible. Glacial coast (snow/stone to the waterline + icebergs), no sandy beach.
//
// WHY NO climate_bias: a cold-only biome table already forces 100% cold-family placement (the biome
// histogram + zero-warm-structure oracles pass on the table alone). A negative temperature bias would
// push the massif OFF alpine (its warmest cold member) toward glacier/taiga, flipping the stone
// subsurface that gives the steep faces their rock read — so the family pin is done by the table, not a
// bias. Declared, not silently improvised.
//
// ICE-BLUE PALETTE (was a v3 declared gap — NOW CONFIG-REACHABLE + set below): the per-world texture
// palette landed as config.textures.{family} (HSV transforms baked into the atlas + propagated to the
// LOD far-shell). The cold Everest palette lives in the `textures` block below — dark blue-grey rock,
// near-white snow, frost grass/tuft, cooled coastal sand/dirt (kills the warm-brown coast).
//
// ─── DECLARED GAPS (config cannot reach these; each needs a shared-file change owned elsewhere) ────────
//   A. ABOVE-TREELINE ACCENTS. surface_decorator.js returns null for every column above `treeline`, so
//      frozen decor only spreads UP TO treeline (raised to 280 here to carry snowy conifers/dead trees/
//      boulders well up the shoulders); lonely accents breaking the highest open snowfields need the
//      treeline-gate exemption owned by the eng-stages lane. Declared.
//   B. CAVES are not config-tunable (density.js reads carvers/caves.js CONSTs directly); the global
//      near-surface spaghetti crust still opens tunnel mouths on the cranked cliff faces for free.
//
// ─── v4 (GLACIAL landform stages — ADDITIVE over the FROZEN v3 surfaces) ───────────────────────────
// v4 layers the shared GLACIAL stages onto v3's accepted terrain WITHOUT touching v3's splines/
// noise/density/palette/biomes/icebergs (working-surfaces law — v3's shape+snow read stays frozen).
// The stages fill the realism gaps in the plan's ref analysis (docs/GLACIAL_GENERATION_PLAN.md):
//   • crag (§A): the 40-320-block ridged crag/gully band + micro-roughness the erosion carver alone
//     under-supplies — jagged sub-ridges on the crests, and it KILLS the voxel contour-terrace furrows on
//     gentle ground (relief-damped so valley floors stay smooth).
//   • trough (§B.1): reshapes the PV valleys into flat-floored, steep-walled U-troughs (the glacier plain).
//   • cirque (§B.2): amphitheater bowls scooped into the high ridge heads (min_altitude on the shoulders).
//   • glacier (§B.3): DECLARED OFF on everest — the ribbon needs a narrow deep U-trough, but v3's broad
//     gentle massif has none, so the floor gate over-claims the shoulders and moraine regresses the snow
//     read (raster-proven). Retained OFF for a future trough-tuned pass; proven on DEFAULT-seed terrain.
//   • surface.snow_score (§C): REPLACES v3's hard snow slope-cut with a probability FIELD that REPRODUCES
//     the same read (slope_max 2.2 == v3's grass_slope, snow-favored threshold) but makes the snow↔rock
//     transition a SALT-AND-PEPPER speckle (ref R5) instead of a paint-bucket band — a paint-bucket band
//     reads too visibly artificial. Slope-driven (ice-age snow is altitude-independent), so band_low
//     is near the waterline and the score saturates fast; the speckle rides the STEEP transition.
// Precedence in block_at (already wired): glacier ribbon (valley floors) → snow_score/rock → biome cover.
//
// ─── v5 (TERRAIN REALISM BASELINE — docs/TERRAIN_REALISM_BASELINE.md; the PROOF WORLD) ─────────────
// v4 was rejected: giant boulders spawned on flat terrain instead of wide mountains AND valleys.
// Root cause (raster-proven locally): smooth
// continentalness base + smooth PV relief = ONE massif on a gradient, and 33% of the surface was
// flat(<2°) shelves the region raster hid under snow+hillshade. v5 rides the relief LADDER:
//   • crag.base 34 (UNSCALED ridge network, ~250 period) — the connected crest/valley NETWORK that
//     threads the whole zone (sim: enclosed-valley 0.01 → 0.08+); kills the "boulder on a plain".
//   • crag.roll 7 — drumlin/moraine mounds; crag.micro P8/A3/O3 + relief_floor 0 — the anti-flat
//     guarantee (sim: pose-local flat 0.33 → <0.10).
//   • trough deepened+narrowed (26 / 0.05 / 0.3) — ONE real deep narrow U-corridor class.
//   • glacier ribbon ENABLED (it finally has a trough home) with a TIGHT floor gate (valley_pv 0.10)
//     so it stays a narrow ICE ribbon (v4's 0.42 gate claimed 25% of the massif as moraine — never
//     repeat). Oracle: ribbon < ~8% of land, reads mostly ice; snow-dominance stays ≥ 0.9.
// v3/v4's noise/density/textures/biomes/icebergs/cirques/snow_score stay verbatim.
//
// ─── v6 (S-24 MACRO-VALLEY REWORK — "still way too granular for the scale, we need real valleys") ───
// v5 was rejected: the relief read as GRANULAR NOISE (many small bumps/crags every ~40 blocks)
// instead of macro glacial structure. Root cause (instrumented locally): over any
// ~2 km region the continentalness base is ~flat (period 7168), so the ONLY macro relief is
// relief×amplitude where relief = pv_to_relief(PV) and PV is FOLDED from weirdness (period 2200,
// OCTAVES 4). Four octaves put strong energy at 550 & 275-block wavelengths ⇒ peaks/valleys every few
// hundred metres = "granular". v5's crag.base 34 (±34 ridged @ 250) piled a RIVAL mid-freq structure on
// top. Measured: MACRO_FRAC 0.387 (detail energy 49 > macro energy 35 — the granular detail DOMINATED),
// prominent valley minima every ~42 blocks. The fix is macro-scale relief COMPOSITION (low-freq valley
// carving dominating, existing detail riding ON it — NOT more detail):
//   • weirdness OCTAVES 4→2 + period 2200→2600: PV becomes a few BROAD folds ⇒ broad massifs + broad
//     valleys km-apart (the master valley field). One change fixes every macro consumer (relief spline,
//     the trough carve, the erosion mask) since they all key off PV/weirdness. MACRO_FRAC 0.39→~0.51.
//   • crag.base 34→8, roll 7→5: the ±34 @ 250 granular RIVAL is cut to a subtle ridge-network texture
//     that RIDES the macro instead of competing with it (band/micro kept — face crag + anti-flat).
//   • trough depth 26→55, wall_pv 0.30→0.42: on the now-low-freq PV field the deep+wide U-trough is the
//     DOMINANT valley — a real deep corridor between massifs, not v5's shallow dip on a busy field.
//   mountain_relief's ±30 ridge/gully (carvers/erosion.js — a SHARED const, DEFAULT-golden-locked, not
//   touched) now reads as coherent ridgeline detail confined to the massif CAPS (its mask is off in the
//   low-PV valley floors), exactly the "detail on the mountains, smooth walkable valleys" composition.
// v3/v4/v5's density/textures/biomes/icebergs/cirques/glacier/snow_score stay verbatim.
//
// ─── v7 (S-24 COMPOSITE SURFACE — realism as a mix of the 3 prior approaches, valley floor starting
// low at ~10) ────────────────────────────────────────────────────────────────────────────────────────
// Picked from the S-24 candidate gallery (a local candidates script), a MIX
// of the three per-column approaches. The new `massif` stage (gen/stages/massif.js) IS that mix as ONE
// scale-coupled function and it now OWNS the everest land surface (`massif.enabled: true`), REPLACING the
// spline + mountain_relief + canyon + crag + trough composition — so no decorrelated ridge/carve systems
// pollute it (the v5/v6 "pasted detail" reject class is structurally impossible now). Recipe (tuned on
// hillshades (a local composite script) → passes the pen-drawing anatomy: dominant summits,
// radiating spurs, branching couloirs, broad valley floors):
//   • TRUNK (candidate C) = macro drainage — broad massif zones vs broad valley CORRIDORS whose floors
//     sit near y≈10 (a "low valley" floor); floor 10 → summit body ≈ 360 uses the FULL vertical
//     budget (was a compressed 152-380 grey band), so relief majesty is dramatic.
//   • SKELETON (candidate A) = within-massif radiating ridge/spur multifractal, riding ON the trunk.
//   • EROSION (candidate B) = derivative-damped face detail (couloirs), coupled to the macro `body`.
//   • MICRO = anti-flat roughness on the gentle floors.
// WATER: everest has NO ocean by design. hydrology.sea_level is dropped to 6 (below the valley floors) so
// nothing floods — the flood base is now config-threaded through gen/hydrology.js (defaults to the
// SEA_LEVEL const ⇒ every other world byte-identical). Glacial STREAMS + pour-point lakes still run.
// SURFACE: the snow-score altitude band + snow_line + treeline are re-anchored for the new 10→360 span
// (snow saturates just above the floors; conifers up to the lower shoulders; bare snow/rock above).
// STAGES OFF: trough (its carve is bypassed by the composite branch), cirque + glacier ribbon (both are
// keyed on the OLD altitude scheme / climate-PV valleys, now decorrelated from the composite valleys —
// disabled + DECLARED; the composite's own couloirs + the snow-score read carry the glacial character).
// v3/v4/v5/v6's density/textures/biomes/decoration/water-optics stay verbatim (splines/crag/mr/canyon
// are now INERT for everest — the massif branch bypasses them — but are left in place, harmless).
//
// ─── v8 (S-24 iter4 — ALPINE SURFACE PAINTER; the block-painting rework) ────────────────────────────
// v7's painting was rejected: block painting needed to realistically confine snowless rock patches to
// very steep slopes with ice higher up, never a simple topmost-block check for snow coverage.
// v7's snow_score was exactly that: a per-column probability (altitude×slope×speckle) whose
// salt-and-pepper transition read as "top-block roulette". v8 swaps it for the `alpine` painter (a config-
// gated stage, gen/stages/surface_by_slope.js — every non-alpine world byte-identical): SNOW is the DEFAULT
// across the massif; ROCK exposes ONLY where the NEIGHBOURHOOD slope (±slope_window — reads a real face, not
// a micro spike) clears a HIGH threshold (couloirs/cliffs), COHERENTLY banded by a low-freq geology mask;
// ICE takes over above ice_line (pure summit ice, a coherent snow/ice mix in the blend; steep summit faces
// still read rock). The painting slope widens via surface.slope_window (default 1 elsewhere). Only the
// surface `snow_score`→`alpine` block changes; shape/noise/density/textures/biomes/decoration stay verbatim.

import { DEFAULT_WORLD_GEN_CONFIG } from '../world_gen_config.js'

/**
 * @typedef {import('../world_gen_config.js').WorldGenConfig & { name: string, biome_pin: string }} NamedWorldConfig
 */

/**
 * The EVEREST / ICE-AGE world (v3) — a deep clone of the DEFAULT recipe + the frozen wide-massif
 * overrides. Cloning DEFAULT keeps every non-overridden section byte-identical to the live engine, so
 * only the deliberate levers below move; each override is a value the gen/render pipeline already
 * consumes (gen/config_adoption.test.js + gen/stages/five_worlds_stages.test.js).
 * @type {NamedWorldConfig}
 */
export const EVEREST_WORLD = {
  ...structuredClone(DEFAULT_WORLD_GEN_CONFIG),
  name: 'everest',
  biome_pin: 'alpine',
  seed: 'khumbu', // re-swept by everest_smoke.mjs for a wide-massif-flank framing near origin
  version: 11, // v11 (NATURE-PLACEMENT GRAMMAR: ecological tree/rock clusters, slope gate, treeline thinning, scree, hero pines)

  // --- CLIMATE FIELDS (fix 1 — wider belts, wider fold-ridges) -----------------------------------
  // continentalness LONG (whole-map continents ⇒ broad mountain bodies). erosion LONGER so low-erosion
  // (mountain-capable) ground forms broad connected BELTS. weirdness LONGER so the PV fold-ridges the
  // massif ridge network rides are WIDE — one massif spans ~1200-1600 blocks, far past the ±256 gen
  // region, so you never see a whole silhouette from the ground (only the LOD reveals the full shape).
  noise: {
    ...structuredClone(DEFAULT_WORLD_GEN_CONFIG.noise),
    continentalness: { period: 7168, octaves: 6, spread: 2, gain: 0.5 }, // continents span the whole map
    erosion: { period: 3600, octaves: 5, spread: 2, gain: 0.5 }, // (v2 2800) mountain BELTS wider than the zone
    weirdness: { period: 2600, octaves: 2, spread: 2, gain: 0.5 }, // (v5 2200/o4) S-24: OCTAVES 4→2 is THE macro fix —
    // 2 octaves = broad smooth folds ⇒ PV is a few BROAD valleys km-apart, not a busy field crenellated every ~300 blocks.
    // The dropped 550/275-block octaves WERE the "granular for the scale" energy; the master valley field is now low-freq.
  },

  // --- TERRAIN SHAPE (v5 — tall wide bodies, NO flat plains, NO OCEAN) ---------------------------
  // v5 TERRAIN SHAPE FIX (too much water — there shouldn't be ocean on everest at all): the whole
  //   continentalness curve is LIFTED LANDLOCKED — the lowest base (200) keeps even trough corridors +
  //   ridge-network valleys + the -0.1 pv dip above the waterline, so nothing floods at sea level. Water
  //   on everest = hydrology only (high glacial streams + pour-point lakes), coverage ≤ ~3% (oracle).
  //   The icebergs die with the ocean (disabled below).
  // erosion_to_amplitude: a WIDE tall shoulder (amp ≥112 out to erosion 0.7) so a broad BELT is tower-
  //   capable; the FLOOR stays 86 so even eroded basins keep real relief.
  // pv_to_relief: the mass-not-needles shoulder — relief is already 0.68 by pv≈0.55 and 0.88 by 0.76, so
  //   the whole massif BODY lifts around a crest (broad shoulders + multiple summits), never one spike.
  // Peak math: base≈246 + amp≈176 × relief 1.0 ⇒ 422 → clamped 382 (peaks near cap). Valley floors:
  //   base 200-210 − 0.1·amp − trough 26 − ladder ⇒ ≈145-190 (the glacier ice band), high country only.
  splines: {
    continentalness_to_base: [
      [0.0, 200],
      [0.32, 210],
      [0.5, 218],
      [0.66, 226],
      [0.84, 236],
      [1.0, 246],
    ],
    erosion_to_amplitude: [
      [0.0, 176],
      [0.3, 156],
      [0.5, 132],
      [0.7, 112],
      [0.85, 98],
      [1.0, 86],
    ],
    pv_to_relief: [
      [0.0, -0.1],
      [0.16, 0.1],
      [0.35, 0.42],
      [0.55, 0.68],
      [0.76, 0.88],
      [1.0, 1.0],
    ],
  },

  // --- S-24 COMPOSITE SURFACE (v7 — the mix of the 3 candidates; OWNS raw_land) ------------------
  // The single scale-coupled function that replaces the spline/erosion/canyon/trough composition (the
  // splines above are now inert for everest — the massif branch in column_gen bypasses them). Tuned on
  // hillshades (a local composite script). floor 10 → body 360 = the full vertical drama;
  // trunk period 1180 (broad km-scale valleys), skeleton period 780 (radiating ridge spurs), erosion a
  // few calm couloirs on the mid-faces, micro anti-flat on the floors. Determinism-safe (gen/stages/massif.js).
  // S-24 iter4 (v9) — reference-terrain critique: scale was massively bigger with wider noise than the
  // reference, mountains should fade into valley gradually rather than abruptly, and peaks should
  // accelerate with clearly visible ridgelines. TWO shape moves:
  //   1. WIDEN the macro noise ~2.2× (trunk 1180→2600, skel 780→1560, warps + amps scaled): with the ~380m
  //      vertical budget capped, spreading the SAME relief over 2.2× the horizontal is what makes the massif
  //      feel massive — one broad valley/flank spans past the near-stream, the LOD reveals the range (ref2/3
  //      cloud-sea of peaks). ero widened to 1300 (couloirs track the wider faces).
  //   2. body_concave 0.38 — compresses low body into LONG gentle valley aprons ("fade into valleys, not
  //      brutally") and ACCELERATES high body into steep peaks ("accelerates for peaks"), so the widened
  //      (gentler-on-average) massif keeps sharp rock-bearing summits + very visible ridge crests. The
  //      skeleton's radiating spurs (now longer at 1560) read as the "long parts descending into the valleys".
  //   PAINTING (surface.alpine below): rock_slope lowered to 2.4 (steep faces of the gentler massif still
  //   expose big coherent rock), COARSE geology mask (no speckle), sun-aspect 0.28 (less snow on the lit
  //   flank), ice lifted to y320 (summit caps only). Tuned on the exact engine paths in valleys_v5/paint_preview.mjs.
  massif: {
    enabled: true,
    floor: 10, // deepest master-valley corridor floor (start the valley low, around 10)
    span: 350, // floor + span = 360 summit body; +erosion headroom keeps peaks off the 382 ceiling
    body_concave: 0.38, // concave fade into valleys + acceleration into peaks (the key shape note).
    // 0.55 over-squashed low body into dead-flat plains + brutal needle peaks; 0.38 keeps continuous sloping flanks.
    trunk_warp_period: 3600,
    trunk_warp_amp: 680,
    trunk_period: 2600,
    trunk_octaves: 5,
    env_lo: 0.12,
    env_hi: 0.6,
    skel_warp_period: 3000,
    skel_warp_amp: 680,
    skel_period: 1560,
    skel_octaves: 5,
    skel_lo: 0.13,
    skel_hi: 0.68,
    shoulder: 0.32,
    ero_period: 1300,
    ero_octaves: 4,
    ero_damp: 30,
    ero_amp: 15,
    ero_face_lo: 0.12,
    ero_face_hi: 0.55,
    ero_crest_fade: 0.82,
    micro_period: 22,
    micro_amp: 2.2,
  },

  // --- S-25 SUB-BIOME REGION LAYER (WORLD-AS-PLANET; the pattern-setter) -------------------------
  // Design intent: each world should read as a planet in its own environment — everest is a cold world
  // with mountains but still needs a lot of variance so no locations look the same (taiga, glacier, ice
  // caves, peaks, ice wasteland, ice forest…). v9's massif OWNS the shape
  // UNIFORMLY, so every place read as one slope of the same mountain. The region field partitions the massif
  // world into five named terrain classes that MODULATE the massif (relief/roughness/height), shift the
  // alpine ice-line (palette), and PIN the biome (decoration + strata follow the region). gen/stages/regions.js.
  //
  //   • field/warp   — a low-freq warped fbm r∈[0,1]; period 2600 ⇒ regions span ~1-2 km (you walk a while
  //                    in one), warp 1300/amp 460 bends the band boundaries organic (pockets, not rings).
  //   • blend 0.07   — adjacent classes cross-fade over a soft band ⇒ the terrain params ramp (no cliffs;
  //                    a peaks flank descends smoothly into the glacier basin — the webm sweep proof).
  //   • variance     — a 2nd low-freq channel jitters the blended profile within a region so two taiga stands
  //                    differ (one flatter/lower, one more rugged/icier) — the "no two locations the same" law.
  //   • classes      — ordered bands over r; relief_scale <1 FLATTENS a region toward the y≈10 valley floor
  //                    (glacier ice basins, flat wastelands), 1 keeps the natural dramatic massif (peaks);
  //                    roughness_scale smooths glaciers / jags peak couloirs; ice_line_delta lowers ice into
  //                    a glacier basin (ice sheet) or raises it to the summit caps only; biome pins route
  //                    decoration (glacier→ice, wasteland→dead scrub, taiga/ice_forest→conifers, peaks→rock).
  // The biome pins resolve against the cold biome table below (dense_forest ADDED for the denser ice_forest).
  // The class-band edges are set at the MEASURED percentiles of the warped region field (fbm clusters at
  // 0.5, so equal r-widths would starve the tails) for a balanced ~13/22/30/22/13 area split — every region
  // is regularly encountered, taiga the common snowy baseline, glacier + peaks the rarer dramatic features
  // (scratchpad probe_rdist.mjs: r p13=0.30 p35=0.43 p65=0.57 p87=0.70). blend 0.045 leaves each narrow
  // middle band a pure core while still cross-fading borders over ~60-100 blocks (no cliffs).
  regions: {
    enabled: true,
    field: { period: 2600, octaves: 2 },
    warp: { period: 1300, octaves: 2, amp: 460 },
    blend: 0.045,
    variance: { period: 260, octaves: 2, relief: 0.16, rough: 0.22, bias: 6, ice: 22 },
    classes: [
      // glacier — flat low ICE basins (ice-line dropped far so the low flats read as an ice sheet).
      {
        name: 'glacier',
        upto: 0.3,
        biome: 'glacier',
        relief_scale: 0.4,
        height_bias: -14,
        roughness_scale: 0.45,
        ice_line_delta: -260,
      },
      // ice_wasteland — flat barren SNOW plains, sparse dead scrub (arctic); smooth, no ice.
      {
        name: 'ice_wasteland',
        upto: 0.43,
        biome: 'arctic',
        relief_scale: 0.52,
        height_bias: -4,
        roughness_scale: 0.55,
        ice_line_delta: -30,
      },
      // taiga — rolling snowy CONIFER forest (moderate relief so it stays below the treeline/ice-line).
      {
        name: 'taiga',
        upto: 0.57,
        biome: 'taiga',
        relief_scale: 0.8,
        height_bias: 0,
        roughness_scale: 1.0,
        ice_line_delta: 0,
      },
      // ice_forest — DENSER frozen woods on higher, rougher shoulders (dense_forest biome ⇒ denser conifers).
      {
        name: 'ice_forest',
        upto: 0.7,
        biome: 'dense_forest',
        relief_scale: 0.9,
        height_bias: 4,
        roughness_scale: 1.1,
        ice_line_delta: 0,
      },
      // peaks — the natural towering massif kept at full relief, jagged couloirs, rock + summit ice caps.
      {
        name: 'peaks',
        upto: 1.01,
        biome: 'alpine',
        relief_scale: 1.0,
        height_bias: 14,
        roughness_scale: 1.45,
        ice_line_delta: 20,
      },
    ],
  },

  // --- HYDROLOGY (v7 — NO OCEAN: sea level BELOW the valley floors; v10 re-anchored) --------------
  // The flood base (gen/hydrology.js) is config-threaded; keeping it BELOW the lowest land keeps every
  // valley DRY — everest doesn't need an ocean. v7 used 6 (< the y≈10 massif floors); the v10
  // REGION flattening (glacier/wasteland relief_scale + height_bias + variance bias) legitimately drops
  // basin floors to the y≥2 massif clamp, so 6 flooded 7.5% of columns (probe-measured — the target
  // ≤ ~3% oracle). The waterline follows the floors: 2 = the clamp ⇒ zero ambient flooding. Glacial
  // STREAMS (rivers) + pour-point lakes ride on land height and still run (meltwater in the corridors).
  hydrology: {
    ...structuredClone(DEFAULT_WORLD_GEN_CONFIG.hydrology),
    sea_level: 2,
  },

  // --- 3D DENSITY / OVERHANG (fix 2 — sharp faces on the STEEPS, clean wide shoulders) -----------
  // Lighter than v2 (which over-cragged the whole massif): the domain warp keeps faces organic, the
  // ridged detail sharpens sub-ridges, and the overhang gate opens only on the STEEPER/HIGHER flank
  // (erosion ≤0.5, pv ≥0.42) so broad gentle shoulders stay clean snow while steep faces undercut and
  // expose the always-on cave crust as tunnel mouths. Bounded: max lift ≈ strength 1.25 × amp 30 ≈ 38 m.
  density: {
    ...structuredClone(DEFAULT_WORLD_GEN_CONFIG.density),
    warp: { period: 300, octaves: 3, amp: 32 }, // 3-octave warp ⇒ meandering, non-repeating faces
    detail: { period: 120, octaves: 5, amp: 30 }, // (v2 amp 36) 5 ridged octaves; lighter so shoulders read wide
    overhang: { erosion_max: 0.5, pv_min: 0.42, strength: 1.25 }, // (v2 0.6/0.34/1.45) crag on the STEEPS, not the whole flank
  },

  // --- STRATA: DISABLED (fix 3) -----------------------------------------------------------------
  // v2 used a monotone ['stone'] strata to hide the temperate dirt/grass peek on steep faces — but strata
  // is evaluated BEFORE the snow stage (column_gen.block_at), so its slope_gate STOLE every steep column
  // to stone before snow could cap it (the snow↔rock inversion root cause). It is no longer needed: the
  // cold biome table has no dirt/grass surface to hide, and the alpine STONE subsurface already reads as
  // clean rock on steep risers. Off ⇒ snow now owns every slope ≤ grass_slope with nothing stealing it.
  strata: {
    ...structuredClone(DEFAULT_WORLD_GEN_CONFIG.strata),
    enabled: false,
  },

  // --- SLOPE / SNOW SURFACE (v8 ALPINE PAINTER; v9 REF-MATCH re-tune — see the massif header above) ---
  // v9 re-tunes the painter for the widened+concave massif: rock_slope 3.4→2.4 (steep faces of the gentler
  // massif still expose big coherent rock), COARSE geology mask (rock_mask_octaves 2, no speckle), sun_aspect
  // 0.28 (less snow on the lit flank), ice_line 288→320 (summit caps only). The v8 prose below still holds.
  // v7's snow_score speckle was rejected: block painting needed to realistically confine snowless
  // rock patches to very steep slopes with ice higher up, never a simple topmost-block check.
  // ROOT of the reject: snow_score is a PER-COLUMN probability field
  // (altitude×slope×speckle) whose salt-and-pepper transition IS "checking the top block to paint it".
  // v8 replaces it with the `alpine` painter (gen/stages/surface_by_slope.js): SNOW is the DEFAULT across
  // the whole ice-age massif; ROCK exposes ONLY where the NEIGHBOURHOOD slope (±slope_window, so it reads
  // a real face, not a single-block micro spike) clears a HIGH threshold — couloirs/cliffs — coherently
  // BANDED by a low-freq geology mask (patches read as geology, not noise); ICE takes over above ice_line
  // (pure near the summits, a coherent snow/ice mix in the blend). snow_score + the legacy snow/slope caps
  // are OFF (the painter owns the pick). treeline 155 still carries conifers up the lower shoulders.
  // Tuned on the exact engine surface (a local paint-preview script): snow≈83% / rock≈11%
  // (couloirs & cliffs only) / ice≈6% (summit caps). rock_slope 3.4 is ≈p92 of the wide-window slope
  // (median ≈1.0, p95 ≈4.0 — the massif is FAR smoother than v5/v6's crag ladder, so v7's slope_max 12 was
  // reading crag noise that no longer exists), so the broad flanks stay clean snow and rock traces the steeps.
  surface: {
    slope_enabled: false, // the alpine painter owns rock exposure (via the wide-window slope)
    snow_enabled: false, // the alpine painter owns snow (it is the default, not a per-column cap)
    snow_line: 10,
    steep_slope: 2.2,
    grass_slope: 2.2,
    scree_enabled: false,
    treeline: 155, // conifers in the corridors + lower shoulders; bare snow/rock/ice on the upper massif
    snow_block: 'snow',
    rock_block: 'stone',
    scree_block: 'stone',
    alpine: {
      enabled: true,
      snow_floor: 4, // below the massif floor(10) − micro: the painter authoritatively owns snow everywhere above
      slope_window: 4, // ± blocks the painting slope is measured over — smooths micro so rock follows coherent faces
      rock_slope: 2.4, // wide-window slope at/above which rock exposes. LOWERED from 3.4: the widened + concave
      // massif is gentler on the flanks (p95≈2.0) but the steep UPPER faces of the peaks clear ~2.4, so whole
      // steep faces read bare rock (ref1's dark pyramids), not just couloir threads; gentle flanks stay snow.
      rock_coherence: 0.22, // the geology mask lowers rock_slope by up to 22% in rocky regions ⇒ coherent rock BANDS.
      // Trimmed from 0.3 so it can't STACK with sun_aspect to drop the threshold onto gentle slopes (scattered flecks).
      rock_mask_period: 420, // BROAD regional rock-proneness (whole-peak scale, up from 260) ⇒ big coherent rock
      rock_mask_octaves: 2, // COARSE (was 3): only broad rock regions, no fine mask octave ⇒ no salt-and-pepper flecks
      sun_aspect: 0.28, // snow is less present on the sun-facing side — a fully sun-facing slope lowers
      // rock_slope by 28% (snow melts off the hot flank, rock shows lower); shade flanks stay snowy. Coherent
      // with the face orientation ⇒ never alternating snow/rock bands. Trimmed from 0.35 (see rock_coherence).
      sun_dx: 0.961,
      sun_dz: 0.276, // unit sun horizontal = cos/sin(0.28 rad), matching the render tod≈0.3 sun
      // (~+x, slight +z) so exposed rock lands on the LIT faces. Baked as literals — no trig in gen/ (§3.7 gate).
      ice_line: 320, // world-y where ice begins (top ~4% — the highest summit caps only); steep summit faces still read rock
      ice_blend: 40, // [320,360] mixes snow/ice coherently (low-freq mask), above 360 ⇒ pure summit ice
      ice_mask_period: 200, // snow↔ice transition patch size (up from 130) ⇒ coherent caps, not cyan/white mottle
      ice_mask_octaves: 2,
      snow_block: 'snow',
      rock_block: 'stone',
      ice_block: 'ice',
    },
  },

  // --- RELIEF LADDER (v5 — the proof-world tune) -------------------------------------------------
  // The four-term ladder over v3's macro splines. base 34 is THE fix for the earlier reject: an UNSCALED
  // ~250-period ridge network threading crests AND valleys across the whole zone (sim: enclosed-valley
  // 0.01 → 0.08, "wide mountains and valleys" instead of one boulder on a gradient). roll 7 lays
  // drumlin/moraine mounds between the ridges; micro P8/A3 with relief_floor 0 is the proven anti-flat
  // floor (sim: pose-local flat 0.33 → <0.10). band stays a moderate 14 — the erosion carver + density
  // detail still supply the big arêtes; the slope-driven snow_score (slope_max 5) absorbs the added
  // steepness without flipping the snow-dominant read.
  crag: {
    enabled: true,
    band_period: 320,
    band_octaves: 4,
    band_amp: 14, // relief-scaled crag texture on the ridges (moderate — arêtes come from the carver)
    base_period: 250,
    base_octaves: 4,
    base_amp: 8, // (v5 34) S-24: the ±34 @ 250 ridge network was a RIVAL mid-freq macro structure that read as
    // granular against the real macro valleys; cut to 8 = a SUBTLE ridge-network texture riding ON the macro.
    roll_period: 60,
    roll_octaves: 3,
    roll_amp: 5, // (v5 7) drumlin/moraine rolling mounds — trimmed so valley floors read as calm snowfields
    micro_period: 8,
    micro_octaves: 3,
    micro_amp: 3, // proven anti-flat (<0.10 pose-local flat) — kills shelves + terrace furrows
    relief_floor: 0, // the ladder rides everywhere; glacier floors stay readable via the trough+ribbon gates
    relief_gain: 0.5,
  },

  // --- GLACIAL §B.1 TROUGH (v5 — ONE deep narrow U-corridor class) --------------------------------
  // v4's wide shallow carve (14 / 0.08-0.4) read as a broad dip, not a U-valley. v5 deepens + NARROWS:
  // full depth only on the tight pv≈0 corridor spine (floor_pv 0.05), walls done by pv 0.3 — a genuinely
  // deep, narrow U-trough the glacier ribbon can live in. The ladder's base term keeps the surrounding
  // valley network varied so the corridor reads carved-by-ice, not stamped.
  // S-24: on the now-LOW-FREQ PV field the trough is the DOMINANT valley (v5's 26/0.3 was a shallow dip on a
  // busy field). depth 26→55 + wall_pv 0.30→0.42 ⇒ a deep, WIDE U-corridor between the massifs — the "real
  // valleys / walkable floors" the design called for. With PV low-freq, wall_pv 0.42 lands the wall top far from
  // the fold centreline, so the U spans ~250-450 blocks (broad), floor (pv≤0.06) ~80 blocks wide + flat.
  trough: {
    enabled: false, // v7: OFF — the massif composite carves its own broad valleys; this PV-keyed carve is
    // bypassed by the composite branch anyway (kept for reference / a future non-massif everest variant)
    depth: 55, // deep U — the corridor floor sits well below the shoulders (ice band ~150-200, above waterline 128)
    floor_pv: 0.06, // flat-floor spine (pv ≤ this = full-depth plain — the walkable snowfield corridor)
    wall_pv: 0.42, // wide U-walls span [0.06, 0.42] on the low-freq PV; ridges above untouched
  },

  // --- GLACIAL §B.2 CIRQUE (v4) -----------------------------------------------------------------
  // Amphitheater bowls scooped into the HIGH ridge heads only (min_altitude on the v3 shoulders ≈250-290).
  cirque: {
    enabled: false, // v7: OFF — cirque is applied AFTER the composite (in raw_land) and its old min_altitude
    // 250 now scoops mid-massif; the composite's own couloirs/valleys carry the glacial read (DECLARED)
    region_size: 220,
    region_rate: 0.6, // ~60% of regions host cirques (sparse, not every ridge)
    per_region: 2,
    radius_min: 24,
    radius_max: 48,
    depth: 26,
    floor_ratio: 0.35,
    lip: 3,
    min_altitude: 250, // high ridge heads only (shoulders/summits)
  },

  // --- GLACIAL §B.3 GLACIER RIBBON + MORAINES (v5 — ENABLED, it finally has a trough home) ------------
  // v4 kept this OFF because the broad gentle massif had no narrow trough: the floor gate claimed ~25%
  // of the massif and painted it moraine (world snow 0.93 → 0.59 — never repeat). v5's deep NARROW
  // trough (26 / 0.05 / 0.3) gives the ribbon a real home, and the gate stays TIGHT: valley_pv 0.10
  // (the corridor spine only) + flat_gate 0.6 (the ladder's micro rides the floor too — a stricter gate
  // would starve the ribbon on ±3-rough floors). THIN moraine stripes (medial 0.02 / lateral 0.02) so
  // the ribbon reads mostly ICE. Oracle (raster-enforced): ribbon < ~8% of land, snow-dominance ≥ 0.9.
  glacier: {
    enabled: false, // v7: OFF — the ice ribbon gates on climate-PV valley floors + the OLD 150-250 ice band,
    // both decorrelated from the composite's valleys (would paint ice on random mid-massif shelves) — DECLARED
    ice_low: 150, // brackets the trough-carved corridor floors
    ice_high: 250,
    flat_gate: 0.6, // floor gate — admits the micro-roughened trough plain, still rejects walls/shoulders
    valley_pv: 0.1, // pv ≤ this = the narrow trough FLOOR only (0.42 claimed the whole massif in v4)
    medial_pv: 0, // 0-DISABLED (glacier.js): the folded-ridge pv CLAMPS to exactly 0 across the whole
    // trough floor here (measured 92%), so ANY positive medial band claims the ENTIRE ribbon as dark
    // moraine (raster: ice-share 1.7%). The ribbon reads ice/firn + crevasse banding instead.
    lateral_band: 0, // 0-DISABLED — same clamped-pv failure class as medial
    crevasse_period: 8, // cross-flow crevasse banding, blocks
    terminal_band: 0, // no hummocky rubble apron — the ribbon fades at the band edge (kept clean)
    firn_band: 40, // granular firn near the top of the band
    ice_block: 'ice',
    firn_block: 'snow',
    moraine_block: 'stone', // dark debris (reads as the moraine stripe under the ice-blue stone palette)
    crevasse_block: 'packed_ice',
    rubble_block: 'stone',
  },

  // --- ICEBERGS — DISABLED with the ocean (v5: no ocean on everest) -----------------
  // Icebergs only place in below-sea columns; the landlocked base curve leaves none. Explicitly off
  // (declared, not mourned) — params retained should a glacial-lake variant ever want them.
  icebergs: {
    enabled: false,
    region_size: 256,
    region_rate: 0.5,
    blobs_min: 3,
    blobs_max: 8,
    radius_min: 6,
    radius_max: 18,
    freeboard: 0.3,
    draft: 0.85,
  },

  // --- WATER OPTICS (cold, clear, steel-blue glacial) ------------------------------------------
  water: {
    body_color: [0.04, 0.12, 0.19],
    shallow_color: [0.22, 0.42, 0.5],
    sigma: [0.55, 0.42, 0.35],
    fade_start: 3.0,
    tint_depth: 8.0,
    deep_floor: 0.14,
  },

  // --- TEXTURE IDENTITY (the glacial ICE-BLUE palette — reference target: dark blue-grey rock under white
  // snow) ---------------------------------------------------------------------------------------------
  // Per-family HSV transforms baked into the atlas COPY (texture_palette.js) + propagated to the LOD
  // far-shell. hue is a ROTATION in degrees; sat/val are MULTIPLIERS. Calibrated against the REAL recipe
  // base colours (not guessed): the atlas STONE base is a cool grey [120,122,126] ≈ h220°/s0.05 — barely
  // blue — so the "dark blue-grey rock" read comes from AMPLIFYING that faint blue (sat ×1.9, NOT
  // desaturating) + darkening (val ×0.85): stone → [97,102,107] (h210/s0.09/v0.42, verified). snow stays
  // near-white with a hair of cool. grass/tuft rotate +108° to FROST BLUE (h≈100→208; a naive +150 would
  // overshoot to purple ~250). sand/dirt are cooled (rotate to blue + desaturate) so the glacial coast +
  // any exposed subsurface reads cold grey-blue, not warm brown. (grass is near-invisible here — Everest
  // grows no grass surface — but the transform keeps any stray tuft + the far-shell tint on-palette.)
  textures: {
    families: {
      stone: { hue: -10, sat: 1.9, val: 0.85 }, // dark blue-grey rock (the hero) — amplify the faint blue, darken
      snow_ice: { hue: -8, sat: 1.5, val: 1.0 }, // near-white snow/ice with a faint cool cast
      grass: { hue: 108, sat: 0.5, val: 1.05 }, // frost blue-white tuft/grass family (rotate green→blue, pale)
      sand: { hue: 150, sat: 0.4, val: 0.9 }, // cold grey-blue glacial coast (kills the warm tan)
      dirt: { hue: 175, sat: 0.4, val: 0.9 }, // cold dark grey-blue subsurface (kills warm brown peek)
    },
  },

  // --- SKY ISLANDS: OFF (floating grass islands would read absurd over an ice-age massif) --------
  sky: { ...structuredClone(DEFAULT_WORLD_GEN_CONFIG.sky), enabled: false },

  // --- DECORATION (sparse frozen valley stands) ------------------------------------------------
  // grove densities sparser than DEFAULT (lonely stands, not a forest on the ice); NO temperate sprite
  // clutter (tall grass / ferns / flowers / reeds) — a cold world grows sparse frost tufts only.
  decoration: {
    ...structuredClone(DEFAULT_WORLD_GEN_CONFIG.decoration),
    tree_grove_one_in: 6, // (DEFAULT 3) LEGACY grove density — inert while `grammar.enabled` (the cluster
    // field owns clumping now); kept as the grammar-off fallback / A-B baseline.
    rock_grove_one_in: 12, // ditto (v5: too many boulders placed without sense). The grammar's
    // scree-field cluster + slope affinity now owns boulder placement (the "slope-clustered talus lever" the
    // v5 comment said didn't exist config-side — it does now).
    sprites: {
      tall_grass: false,
      fern: false,
      flower: false,
      reed: false,
      // VIVID-WORLD alpine accents (opt-in): frost shrubs, alpine flowers, lichen — the treeline species gradient.
      frozen_shrub: true,
      alpine_flower: true,
      lichen: true,
    },
    // NATURE-PLACEMENT GRAMMAR (v11 — the prior uniform scatter read as random with no ecological logic;
    // reference target: Conquest Reforged and Massive Mountains). Replaces the uniform grove-cell
    // scatter with an ecological grammar (deco_shared, shared by the near decorator + far impostor mirror):
    //   • CLUSTER field (period 100, warp 30) — conifer STANDS with organic edges + snow CLEARINGS between,
    //     not a pole field. threshold 0.52 keeps ~40% open snow; per-region canopy_density sets stand density.
    //   • SLOPE gate (tree_slope_max 1.8) — trees on valley floors + ROLLING flanks; only the genuinely steep
    //     massif faces read bare (the alpine painter's rock/snow), matching the ref's wooded-valley/bare-face
    //     split. slope_step 3 reads a real face, not a micro spike.
    //   • TREELINE thinning (band 45 below treeline 155) — krummholz: stands thin out toward the treeline
    //     instead of a paint-line, then bare snow/rock/ice above.
    //   • SCREE fields (rock_slope_boost 2.5) — boulders/talus densify on the steep faces the trees vacate
    //     (Conquest Reforged "talus fields" / "debris-filled mountain sides"), clustered so they read as
    //     fields, sparse erratics on the flats.
    //   • HERO pines (1-in-35) — the occasional towering pine_cathedral landmark rising out of a stand.
    grammar: {
      enabled: true,
      // cluster_threshold 0.52 keeps ~40% of a forested region as open snow CLEARINGS. WALKABILITY (forests
      // must stay walkable — they can't be ultra dense either): canopy_density IS the
      // stand-CORE anchor fraction (the cap), tuned PER REGION so ice_forest reads densest yet stays
      // traversable (~4-block trunk spacing) — the canopies overlap wide (dense from outside), the trunks
      // leave a path (walkability GATED by gen/nature_grammar.test.js: ≥60% open ground + long straight
      // trunk-free lanes over the densest stand). These tune from config, no code.
      cluster_period: 100,
      cluster_octaves: 2,
      cluster_warp: 30,
      cluster_threshold: 0.52,
      cluster_softness: 0.2,
      canopy_density: 0.05, // default for any tree biome not in the per-region map below
      biome_density: {
        dense_forest: 0.06, // ice_forest — the densest cold forest, still ~4-block trunk spacing (walkable)
        taiga: 0.04, // open boreal snow forest — sparser conifer stands with snow between
        arctic: 0.015, // ice_wasteland dead scrub — lonely snags, near-barren
      },
      // slope gate: gentle valleys + ROLLING flanks (slope <1.2) keep full forest; only the genuinely STEEP
      // massif faces (slope ≥1.8, p90 of the high band) go bare rock+scree. 1.2 over-thinned rolling taiga
      // (its normal terrain), so trees stop at 1.8, not 1.2. Above the treeline 155 ⇒ zero trees regardless.
      tree_slope_max: 1.8,
      slope_softness: 0.6,
      slope_step: 3,
      treeline_band: 45,
      rock_slope_boost: 2.5,
      rock_density_scale: 1.0,
      hero_species: 'pine_cathedral',
      hero_one_in: 35,
    },
  },

  // --- FROZEN-VALLEY DECOR (config-reachable half of fix "not other trees nor bushes") ----------
  // structure_pool_overrides MERGES bundle pools onto a biome's tree/rock sets by biome NAME
  // (surface_decorator resolves + splits by category), CONFIG-ONLY. So the cold biomes the placer drops
  // grow frozen conifers, dead shrubs, alpine/ice boulders — the massif reads cold, trees live in the
  // valleys (taiga/river), bare snow+rock+boulders own the heights. Pools verified in
  // assets/schematics/schematics.json: pool_conifers(12, incl. snowy spruce), pool_dead_trees(12),
  // pool_rocks_alpine(8), pool_ice(31). (The glacial ICE-BLUE cast on the rock/snow is the `textures`
  // block above — no longer a declared gap.)
  structure_pool_overrides: {
    alpine: ['pool_rocks_alpine'], // the massif: boulders scatter, trees stay in the valleys below
    taiga: ['pool_conifers'], // conifer valley belts (v5: rocks dropped — no boulder confetti mid-forest)
    river: ['pool_conifers', 'pool_dead_trees'], // frozen river-valley stands
    arctic: ['pool_dead_trees'], // dead scrub (v5: pool_ice/rocks dropped — the "scattered ice chunks
    // mid-forest" litter was rejected; ice formations stay on the glacier biome only)
    glacier: ['pool_ice', 'pool_rocks_alpine'], // ice tongues in the deep-snow basins
  },

  // --- BIOMES (cold family ONLY — the placer consumes this; palms are impossible) ---------------
  // 'beach' (the PALM_TREE biome) is REMOVED, killing palms at the root. Subsurface is STONE on the
  // massif/valley-wall biomes so any exposed steep riser reads as rock (never dirt); glacier keeps a SNOW
  // subsurface for its deep-snow valley floors. ids identical to the module BIOME_REGISTRY (persisted,
  // never renumbered). alpine (low erosion, high pv) wins the massif; taiga/arctic/glacier/river the
  // wetter/higher-erosion valleys.
  biomes: [
    // 'ocean' REMOVED at v5 with the landlocked base curve (no ocean on everest by design) — a dry-land
    // "ocean" biome would have painted sand at altitude. Low-continentalness ground falls to the
    // nearest cold member (arctic/taiga) instead.
    {
      id: 2,
      name: 'river',
      climate: { temperature: 0.3, humidity: 0.7, continentalness: 0.55, erosion: 0.7, pv: 0.02 },
      weight: 1.2,
      weirdness_gate: false,
      land: { surface: 'snow', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0.05,
      grass_density: 0.1,
      structure_pools: [],
      music_bed: 'river',
    },
    {
      id: 7,
      name: 'taiga',
      climate: { temperature: 0.28, humidity: 0.4, continentalness: 0.7, erosion: 0.6, pv: 0.55 },
      weight: 1,
      weirdness_gate: false,
      land: { surface: 'snow', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0.2,
      grass_density: 0.2,
      structure_pools: ['pool_conifers'],
      music_bed: 'taiga',
    },
    // dense_forest — the ICE_FOREST region's pinned biome (module id 5 ⇒ the decorator resolves its denser
    // tree_density 0.35 > taiga's 0.2). Frozen land palette (snow/stone); grows dense conifers via tree_species below.
    {
      id: 5,
      name: 'dense_forest',
      climate: { temperature: 0.3, humidity: 0.7, continentalness: 0.66, erosion: 0.6, pv: 0.52 },
      weight: 1,
      weirdness_gate: false,
      land: { surface: 'snow', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0.35,
      grass_density: 0.15,
      structure_pools: ['pool_conifers'],
      music_bed: 'taiga',
    },
    {
      id: 8,
      name: 'arctic',
      climate: { temperature: 0.1, humidity: 0.6, continentalness: 0.68, erosion: 0.7, pv: 0.5 },
      weight: 1,
      weirdness_gate: false,
      land: { surface: 'snow', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0.04,
      grass_density: 0.1,
      structure_pools: ['pool_dead_trees'],
      music_bed: 'arctic',
    },
    {
      id: 9,
      name: 'glacier',
      climate: { temperature: 0.05, humidity: 0.85, continentalness: 0.6, erosion: 0.5, pv: 0.6 },
      weight: 1,
      weirdness_gate: false,
      land: { surface: 'snow', subsurface: 'snow', underwater: 'stone', filler: 'stone' },
      tree_density: 0,
      grass_density: 0,
      structure_pools: ['pool_ice', 'pool_rocks_alpine'],
      music_bed: 'arctic',
    },
    {
      id: 13,
      name: 'alpine',
      climate: { temperature: 0.3, humidity: 0.45, continentalness: 0.72, erosion: 0.15, pv: 0.85 },
      weight: 1.05,
      weirdness_gate: false,
      land: { surface: 'stone', subsurface: 'stone', underwater: 'stone', filler: 'stone' },
      tree_density: 0.05,
      grass_density: 0.1,
      structure_pools: ['pool_rocks_alpine'],
      music_bed: 'alpine',
    },
  ],

  // --- TREE SPECIES (S-25: the ICE_FOREST region reuses the dense_forest biome, whose DEFAULT roster is
  // temperate oak/birch — override it to dense frozen CONIFERS so ice_forest reads as denser taiga, not a
  // warm broadleaf wood). The other cold biomes keep DEFAULT's cold-appropriate rosters (taiga → pine
  // cathedral, arctic → snags, alpine → spruce). Read only under procedural trees (inherited on). --------
  tree_species: {
    ...structuredClone(DEFAULT_WORLD_GEN_CONFIG.tree_species),
    dense_forest: [
      { species: 'pine_cathedral', weight: 3 },
      { species: 'spruce_mid', weight: 4 },
    ],
    // ALPINE = the bare rocky massif ("boulders scatter, trees stay in the valleys below" — the
    // structure_pool_overrides note). DEFAULT's alpine roster (spruce/snag) inherited above would grow
    // conifers on the LOW peaks flanks (below the treeline) — contradicting that design AND drifting the
    // far impostor seam (the far shell has no alpine tree rule ⇒ near-only trees). Empty roster ⇒ alpine
    // grows rocks only, matching both the design and the far mirror. (river has no roster ⇒ already treeless.)
    alpine: [],
  },
}
