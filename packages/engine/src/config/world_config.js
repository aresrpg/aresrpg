// World-level constants + deterministic seed derivation (§3.4, §3.7, §10.5).
//
// DETERMINISM LAW (§3.7): integer arithmetic ONLY. splitmix64 uses BigInt (arbitrary-precision
// integer ops — exact and portable across every JS engine, unlike Math.sin/cos/pow/exp which are
// implementation-approximated). NEVER import Math.sin/cos/tan/pow/exp/log/random here or in any
// gen-facing helper derived from this module.

/** Hardcoded master world seed (§10.5) — never user-configurable at v1. */
export const MASTER_SEED = 'aresrpg'

/**
 * Generator identity version — bumped whenever the terrain-shaping math changes in a way that moves
 * the world-identity golden hash (§3.7, §4 world-fork policy). Lives beside the seed derivation so
 * the (seed, version) pair fully identifies a world.
 *   1 → M1 pure heightfield (spline surface + water fill, no 3D density).
 *   2 → NG1-A unified 3D density: consume terrain_shaper's ±band for ridged/warped overhangs +
 *        cliffs, cave-subtract seam, and an inverted sky-island shell — all from one field (§2.2).
 *   3 → NG1-B canyons/hydrology/erosion-look + deeper caves: relief-amplitude retune (mountain belts
 *        ~100-160 blocks), per-column mountain erosion ridgelines/gullies, inverted-ridge CANYON
 *        carving, RIVERS (thin ridged-crest lines) + LAKES + WATERFALLS, and worley caverns + worms
 *        through the cave seam (cavern rooms flagged in meta). Terrain moves ⇒ golden re-blessed.
 *   4 → VEG-B legacy schematic forests + rocks (2026-07-03): the procedural lollipop trees are
 *        replaced by the aresrpg-legacy Sponge schematics (20 tree species + 14 rock variants) via
 *        the deterministic stamper, with a cross-chunk halo so wide canopies straddle chunk borders.
 *        Decoration lives OUTSIDE the world-identity hash (world_gen.js layer), so the column golden
 *        hash is UNMOVED — this bump records the decorated-world fork, not a terrain-core change.
 *   5 → Pandora sky islands, region-gated; placeholder shell RETIRED.
 *        The v2 inverted ridged SHELL (a horizontal noise slab that produced fish-bone ribbons across
 *        the whole sky) is replaced by real Avatar/Hallelujah-Mountain floating masses — broad domed
 *        tops necking into stalactite roots, clustered into archipelagos, REGION-GATED to dedicated
 *        sky-island regions (~1 in 8 region cells; empty sky elsewhere). Sky is a fork of the density
 *        field ABOVE y≈270; all ground terrain below is BIT-IDENTICAL to v4 (asserted in
 *        density.test.js). The column golden hash MOVES (the sky solid set changed) — re-blessed.
 *   6 → DIVERGENCE WAVE cross-flora (2026-07-03): the waist-high grass OCEAN — dense tall_grass across
 *        grass biomes (5-10× the old tuft scatter, grove-clustered into meadows with shorter paths),
 *        SHORE reeds on water-adjacent margins, meadow flower patches, and forest-floor fern undergrowth.
 *        Like the v4 schematic-forest fork, decoration lives OUTSIDE the world-identity hash (world_gen.js
 *        layer, after fill_chunk_from_profile), so the column golden hash is UNMOVED from v5 (verified —
 *        column_gen.test.js still passes its v5 golden); this bump records the decorated-world fork only.
 *   7 → TERRAIN REALISM BASELINE (2026-07-07, docs/TERRAIN_REALISM_BASELINE.md): the crag stage
 *        generalizes into the DEFAULT relief LADDER (crag.enabled true everywhere) — relief-scaled
 *        crag band + UNSCALED ridge network (base) + drumlin roll + anti-flat micro folded into
 *        raw_land for every world (realistic terrain for all biomes; kills both
 *        reject classes: "boulder on a flat plain" + dead-flat shelves). TERRAIN moves world-wide ⇒
 *        the column golden hash + decorated goldens are deliberately re-blessed (sanctioned fork).
 *   8 → PROCEDURAL TREES BECOME THE DEFAULT (2026-07-11, ENGINE_AAA_PLAN C4): trees.procedural flips
 *        true in DEFAULT_WORLD_GEN_CONFIG, so every world (the default + the five structuredClone
 *        trailers) now grows SYNTHESIZED species skeletons (gen/trees/tree_gen.js, the per-biome
 *        tree_species roster) instead of the legacy Sponge schematic tree stamps, which are RETIRED
 *        (BIOME_SCHEMATICS[*].trees emptied; rocks + the per-biome tree_one_in DENSITY gate stay).
 *        `?proctrees=0` is the escape hatch (procedural OFF ⇒ a rock-only world, the perf A/B that
 *        isolates the proc-tree cost). WHAT this fork changes: decorative TREE CONTENT (which voxels a
 *        forest column grows) across every world. WHAT it does NOT change: the terrain-core column
 *        golden hash (decoration lives OUTSIDE it, world_gen.js layer — UNMOVED, asserted by
 *        column_gen.test.js) and therefore surface_y, spawn scan, water fill, and every on-chain
 *        object position/coordinate — chain state stays valid, only the render-side tree voxels move.
 *        Decorated goldens (config_adoption GOLDEN_DECORATED) deliberately re-blessed (sanctioned fork).
 *   v9 — BAKE-THEN-STAMP DEFAULT — pregenerate a lot of
 *        different trees and use them as schematics: trees.baked_variants=32 in the DEFAULT recipe.
 *        Procedural trees are pre-baked (32 deterministic variants per species, gen/trees/tree_bake.js)
 *        and STAMPED like schematics (O(1) hash-pick + a 4-rotation lever ⇒ ~128 distinct reads per
 *        species) instead of synthesized per column — forest chunk gen collapses to ~stamp cost (the
 *        schematics loading way faster). `?baketrees=0` is the escape hatch (the old
 *        every-tree-unique per-column synthesis). Same fork envelope as v8: decorative TREE CONTENT only;
 *        terrain-core goldens/surface_y/spawn/chain coords UNMOVED; GOLDEN_DECORATED re-blessed.
 *   10 → SUB-BIOME REGION LAYER (2026-07-12, S-25 "world-as-planet"): a low-frequency region field
 *        (gen/stages/regions.js) partitions a MASSIF world into named terrain regions (taiga / glacier /
 *        peaks / ice_wasteland / ice_forest) that modulate the massif surface + pin the biome + shift the
 *        alpine ice-line — so EVEREST reads as many terrains, not one uniform massif (each world
 *        has a lot of terrain variety; no locations look the same). Config-first + everest-only:
 *        absent/enabled:false ⇒ identity ⇒ the DEFAULT world + the other four recipes are byte-identical
 *        (only everest's generated output moves — a declared, everest-scoped fork). The GEN_VERSION bumps
 *        globally (cache/identity marker); DEFAULT.version tracks it though DEFAULT's bytes are UNMOVED.
 *   11 → NATURE-PLACEMENT GRAMMAR (2026-07-12 — the prior scatter read as random with no ecological logic;
 *        reference: Conquest Reforged and Massive Mountains). The uniform grove-cell
 *        scatter is replaced by an ECOLOGICAL grammar (deco_shared): forest CLUSTERS with organic edges +
 *        clearings, a SLOPE gate (bare steep faces), TREELINE thinning (krummholz), scree fields on steeps,
 *        and a rare hero-tree channel — shared by the near decorator + the far impostor mirror (seam exact).
 *        Config-first + everest-only: `decoration.grammar.enabled` off/absent ⇒ the legacy scatter ⇒ DEFAULT
 *        + the other four recipes byte-identical (only everest moves — a declared everest-scoped fork, same
 *        discipline as v10). GEN_VERSION bumps globally; DEFAULT.version tracks it, DEFAULT bytes UNMOVED.
 *   v12: FLAT-SMOOTH — crag `flat_lo/flat_hi` damps the roll+micro jitter on low-relief
 *        plains (walkable land read as rubble). The DEFAULT (Testlands) byte-freeze was LIFTED for
 *        this: DEFAULT + every DEFAULT-clone spline world (paradise/rainforest/ember_steppe/everglades) MOVE;
 *        everest is massif (crag bypassed) ⇒ unmoved. GOLDEN_DECORATED/GOLDEN_SURFACE re-blessed.
 *   v13: SPAWN-CLEARING — every world's INITIAL spawn region must be walkable — never
 *        water-locked, never tree density so high the shore reads as one solid block (the verdant_hollow
 *        repro). DECO_DEFAULTS.spawn_clear_radius/falloff SUPPRESS trees near the world spawn anchor (origin)
 *        on EVERY world (a hard-clear glade + a ramp back to full forest). DECORATION-ONLY: GOLDEN_DECORATED
 *        moves (near-origin trees), GOLDEN_SURFACE is UNMOVED (terrain/surface_y/spawn/chain coords valid).
 *   v14: REGION-DRIVEN TERRAIN CORPUS-WIDE + SPAWN DRY-FLOOR (ONE
 *        bump for the whole round-2 pass). (a) The S-25 region layer now DRIVES terrain on the CLASSIC
 *        spline path (column_gen.raw_land_no_cirque, gated on regions.drives_terrain) and all 20 spline
 *        worlds carry per-region relief/height_bias/roughness knobs ("each to their own settings") — each
 *        world's own bytes move; DEFAULT carries no regions so (a) does NOT move it. (b) The SPAWN DRY-FLOOR
 *        (hydrology.spawn_dry, code defaults radius 24 / falloff 24 / margin 2): land within the spawn glade
 *        is lifted to ≥ sea_level+2 on EVERY world (the water-locked-spawn guarantee; find_open_spawn stays
 *        the last-resort net, never the primary) — moves near-origin terrain wherever it was wet, DEFAULT
 *        included ⇒ GOLDEN_DECORATED re-blessed (GOLDEN_SURFACE = the smooth spline probe, unmoved by
 *        construction). On-chain spawn x/z stay valid: Y is surface-sampled at render time (round-1 verdict).
 */
export const GEN_VERSION = 14

// ---- Geometry constants (§3.4) ----------------------------------------------------------

/** One chunk edge, in blocks. u32-bitmask-aligned for the binary greedy mesher. */
export const CHUNK_SIZE = 32
/** Total world height, in blocks (12 chunks stacked). */
export const WORLD_HEIGHT = 384
/** Sea level, in world-space block y. */
export const SEA_LEVEL = 128
/** Hard floor (bedrock) world-y — the density carver never punches solid below this (§2.2). */
export const HARD_FLOOR_Y = 3
/** Player VISUAL height, in blocks — the avatar rig normalises its bind-pose to this (character_avatar.js),
 *  and the first-person eye + camera head anchor + overhead nameplates all derive from it (× 0.9). Players
 *  only; mobs render at their own reference-corpus-authored INTRINSIC height instead (sizes
 *  are corpus-faithful — mob_model.js's prepare_mob_render, no blanket constant any more). [2026-07-10:
 *  characters grow to 2 blocks so the first-person camera also rides up] — was 1.5. */
export const CHARACTER_HEIGHT = 2.0
/** Player PHYSICS-CAPSULE height, in blocks — deliberately 0.1 SHORTER than the visual crown so a 2-block
 *  body still clears a 2-block ceiling gap. box_overlaps_solid checks the cell at floor(feet + h − skin),
 *  so a collider exactly as tall as the visual (2.0) head-bumps the instant the feet lift a hair off the
 *  floor (float jitter, a terrace lip) — every 2-block passage would snag. 0.1 headroom buys ~0.1 blocks
 *  of feet-lift tolerance under a 2-gap (the Minecraft pattern: visual ≈ collider, collider a hair under
 *  the grid). collision.js reads this as its default capsule height. */
export const CHARACTER_COLLIDER_HEIGHT = CHARACTER_HEIGHT - 0.1
/** Player capsule radius, in blocks. */
export const CHARACTER_RADIUS = 0.4
/** One block = one meter. */
export const BLOCK_SIZE_METERS = 1
/** Chunks stacked vertically per world column. */
export const CHUNKS_PER_COLUMN = WORLD_HEIGHT / CHUNK_SIZE
/** Side length of a fight-grid cell, in blocks (§6.6). */
export const FIGHT_CELL_SIZE = 4
/** Tactical-BOARD cell size, in blocks (metres) — the ENG-16 board's 2×2 cells (board.js
 *  DEFAULT_CELL_SIZE). Mirrored here as a config constant so gen (cave_room.js) can size the flat
 *  board region without importing the render/tactical layer. Keep in lockstep with board.js. */
export const DEFAULT_CELL_SIZE_HINT = 2
/** Inclusive [min, max] fight-grid side length, in cells (§6.6). */
export const FIGHT_GRID_CELLS_MIN = 10
export const FIGHT_GRID_CELLS_MAX = 18
/** Region scope for structure generation, in chunks (§4.6). */
export const REGION_SIZE_CHUNKS = 8

/** Horizontal streaming-ring load radius, in chunks — the SINGLE SOURCE OF TRUTH for view distance
 *  (config-first law). engine.js passes this to create_ring_manager; the fog wall is pinned to it via
 *  ring.fog_far_ceiling_m() so terrain is never born in front of the fog. Loaded edge = this × CHUNK_SIZE
 *  metres (r6 → 192 m); fog far = (this−1.5) × CHUNK_SIZE (ring_manager fog_far_ceiling_m → 144 m at r6).
 *
 *  D33 view-distance lever (raise view distance — the previous setting mostly showed fog). Set from the r5/6/7/8
 *  headed-Metal A/B sweep (bench/d33_radius.spec.js, report /tmp/aresrpg-engine-artifacts/d33_report.json).
 *  KEY FINDING: steady-state frame-time is FLAT across r5→r8 (rotation & fly p99 ≈ 9.3 ms everywhere,
 *  half the 12 ms ceiling) — the NG-MEGA quad pool + one-mesh/frame pacing make view distance free at
 *  runtime. The ONLY cost is cold-boot time-to-drained (mesh is 1 chunk/frame): r5 6.3 s → r6 8.8 s →
 *  r7 11.9 s → r8 15.3 s. 6 is the largest radius that passes ALL the sweep gates (p99 ≤ 12 ms AND
 *  cold-drain ≤ 1.8× the r5 control = 11.3 s; r6 = 1.41×). r7 (224 m, a bigger fog push) clears every
 *  gate EXCEPT cold-drain (1.90×, misses the 1.8× line by ~0.6 s) — since frame-time is identical,
 *  bumping this to 7 is a safe tradeoff if a ~3 s longer one-time cold boot is acceptable for +40 %
 *  view. Was 5 (112 m fog) pre-D33. The demo overrides per-load via ?load_radius=N (bench hook).
 *  ARCHITECT CALL (2026-07-03, post-sweep): bumped 6→7 — the driving complaint IS the fog
 *  wall ("I mostly see fog in the distance"), frame-time is measured-identical, and the 49 ms
 *  cold-drain budget miss buys +40 % view (224 m edge, 168 m fog). NG-LOD phase B's far-shell hides
 *  the cold edge behind horizon sections anyway. Revert = set 6; per-load A/B = ?load_radius=N.
 *
 *  NG-LOD PHASE B PULLBACK — 150 blocks of distance is enough
 *  for full detail; it can degrade after, with immersive haze making the falloff read well: 7→5. The
 *  smooth far shell (far_field.js) now OWNS everything beyond the near ring — a continuous heightfield
 *  under aerial haze/desaturation, coarse-first + GAPLESS (parent-substitution covers the whole disc
 *  from the first frame), dither-swapped to full detail as chunks arrive. So the near VOXEL ring only
 *  needs FULL detail out to ~160 m (5 × 32 = 160 m ≈ the target 150). This RECLAIMS the r7 cold-boot
 *  cost (near-drain drops back toward the ~6.3 s r5 measurement) AND cuts per-frame streaming churn
 *  during flight (fewer chunks stream as the camera moves → lower fly p99). The far shell's inner
 *  boundary tracks this automatically (far_streamer reads loaded_radius_blocks() = 160 m), and the far
 *  material haze band starts near the seam so the transition reads clean. Per-load A/B: ?load_radius=N.
 *
 *  5→7 (224 m detail edge): flying a dev camera at altitude, the
 *  160 m detail disc reads tiny and the smooth far shell dominates every vista ("the LOD hiding the real
 *  terrain" — the residency mask is PROVEN correct on every path incl. reload-world/tier-switch; what's
 *  visible at altitude is the design boundary itself). D33 sweep: frame-time FLAT r5→r8; the cold-boot cost
 *  is now mitigated by the adaptive mesh ladder. ENG-19 (fixed world: the whole 300×300 zone resident,
 *  shell only beyond the border) supersedes this when it lands. */
export const LOAD_RADIUS_CHUNKS = 7

/** [S-85] Per-tier streaming radius (chunks) — a "reduced chunk gen" LOW ask made
 *  view distance tier-driven. LOW 4 (128 m detail edge — mobile/very-low-end, fewer gen+mesh+upload
 *  jobs), MEDIUM 7 (= LOAD_RADIUS_CHUNKS, UNCHANGED — the p99≈9.3ms baseline law, the most-played
 *  tier), HIGH 8 (256 m — the sweep's next rung up; frame-time is flat r5→r8 per D33, only cold-boot
 *  drain grows). engine.js resolves this from the BOOT tier (the ring reads its radius at build; an
 *  explicit `load_radius` arg — the demo `?load_radius=N` bench — still wins). Mid-session tier
 *  changes keep the boot radius (the ring has no live re-stream); render_scale still switches live. */
export const TIER_LOAD_RADIUS = /** @type {Record<'low'|'medium'|'high', number>} */ ({
  low: 4,
  medium: 7,
  high: 8,
})

/** ADAPTIVE STREAMING THROUGHPUT (2026-07-03 — the coarse far shell covered fresh territory
 *  for ages before detail streamed in). The cold-boot bottleneck was NOT gen (the pool
 *  delivers the whole r5 disc in ~3 s) but the render-thread MESH pacing, hard-pinned at 1 chunk/frame
 *  (~65 chunks/s at 60 fps). A full r5 disc (~1450 chunks) drained in ~13.5 s; post-flight recovery
 *  ~20 s — "ages" in a cold boot. Fix: pace mesh (and its downstream upload byte budget) ADAPTIVELY
 *  by pending-queue depth, so a big backlog drains fast while a quiet ring costs ~nothing — all inside
 *  a hard per-frame wall-clock slice so frame-time never tanks (that's the whole point of pacing).
 *
 *  MESH_PACING_STEPS: [queue_threshold, meshes_per_frame] ladder, APPLIED LOW→HIGH (last threshold
 *  ≤ depth wins). meshes/frame rises with backlog: 1 when <32 queued, 4 when ≥128, 8 when ≥512. The
 *  wall-clock deadline (MESH_BUDGET_MS, two-level) still caps a dense burst — the count is the CEILING,
 *  the budget is the real governor, so a run of dense chunks stops early and carries to the next frame.
 *  A dense surface chunk is ~1-3 ms CPU to mesh; the 3 ms base slice fits ~1-2 dense or ~8 cheap, keeping
 *  the frame inside the 16.6 ms/60fps envelope even at the top step (measured steady flight p50 ~8.3 ms).
 *
 *  UPLOAD scaling: the GPU upload queue is a SEPARATE downstream throttle (byte budget/frame). Meshing
 *  N/frame is wasted if uploads still trickle at ~3/frame, so the byte budget scales on the SAME ladder
 *  (UPLOAD_BUDGET_STEPS, in chunk-equivalents × ~10 KB dense chunk; idle ⇒ 3, deep backlog ⇒ 8). Post-
 *  boot the upload is a cheap buffer write into the pre-allocated NG-MEGA pool (pool_renderer
 *  write_chunk); at BOOT the first upload of each material variant compiles a pipeline (expensive, one-
 *  time) — which is exactly what the closed-loop FRAME_GOVERNOR_MS below catches, self-throttling the
 *  budget to the floor until the compiles are paid. Tunable here (config law); shipped default, no
 *  bench query param. */
export const MESH_PACING_STEPS = /** @type {const} */ ([
  [0, 1],
  [32, 2],
  [128, 4],
  [512, 8],
])
/** Wall-clock ceiling (ms) for main-thread meshing per frame — a REAL governor above the step count.
 *  Checked between chunks (never mid-chunk): one chunk always meshes, then we bail once the slice is
 *  spent and carry the rest. TWO levels, picked per-frame by measured recent frame time:
 *   - BASE (3 ms): the always-safe slice. Used whenever the recent frame was NOT cheap (near/over one
 *     vsync — e.g. boot frames sharing the frame with upload pipeline-compiles). Keeps the boot p75 gate
 *     (≤17.67 ms) flat, matching the old stable 1-mesh cadence's headroom.
 *   - RELAXED (5 ms): used only when the recent frame was genuinely cheap (< MESH_RELAX_UNDER_MS, i.e.
 *     comfortably inside one vsync with no compile contention — the post-flight HOVER-recovery case where
 *     the backlog is pure CPU meshing of already-generated chunks). Drains a deep backlog ~2× faster
 *     (measured recovery 12 s → ~7 s) while a spent 5 ms slice + the ~8 ms render still lands ~13 ms. */
export const MESH_BUDGET_MS = 3
export const MESH_BUDGET_RELAXED_MS = 5
/** ENG-14 (2026-07-04) GPU-BOUND mesh slice (ms). When the recent frame ran WELL OVER one vsync
 *  (> MESH_GPU_BOUND_OVER_MS) the bottleneck is the GPU (froxels + volumetric clouds + bloom at the
 *  a native 5K display), NOT the main thread — which sits LARGELY IDLE waiting on the GPU. Meshing then
 *  overlaps that GPU idle almost for FREE, so a much bigger slice drains the queue several × faster
 *  while barely moving the (already GPU-limited) frame time. This is the INVERSE of the RELAXED gate
 *  above (which relaxes on CHEAP frames): here we relax on EXPENSIVE frames because their cost is off
 *  the main thread. ROOT FIX for the "LOD takes a minute" complaint at 5K/ULTRA — at 17-25 fps there are
 *  too few rAF frames to drain 1450 chunks at the timid 3 ms/frame; a 16 ms slice on a 50 ms GPU-bound
 *  frame lands ~55 ms (still ~18 fps) yet meshes 4-6× more per frame. MEASURED 8K/dsf2: drain 35→~12 s. */
export const MESH_BUDGET_GPU_BOUND_MS = 16
/** Recent-frame-time (ms) above which the GPU-BOUND slice engages — the frame is so far past one vsync
 *  (~2× a 60 Hz refresh) that it is unambiguously GPU-limited, so the main thread has the headroom to
 *  mesh aggressively in the shadow of the GPU work. Above the FRAME_GOVERNOR_MS ceiling so it only fires
 *  on genuinely heavy frames, never on healthy vsync-locked ones. */
export const MESH_GPU_BOUND_OVER_MS = 30
/** Recent-frame-time threshold (ms) under which the RELAXED mesh slice is allowed. Set AT one vsync
 *  interval (17 ≈ 16.6) so it engages on healthy vsync-locked drain frames (the hover-recovery case,
 *  where frames sit right at the refresh with mesh headroom to spare) but NOT on genuinely stressed
 *  frames that overshoot a refresh — the same wall-clock-dt signal the frame governor reads. A drain
 *  frame parked to vsync has ~8 ms of real headroom, so spending 5 ms of it on mesh keeps it inside the
 *  refresh; a frame already at 20 ms (mid-boot-compile or a far-shell rebuild) drops back to the 3 ms base. */
export const MESH_RELAX_UNDER_MS = 17
/** CLOSED-LOOP FRAME GOVERNOR (2026-07-03). The adaptive ladders must never tank frame-time (that's the
 *  whole point of pacing). The ring reads the recent frame duration each update; when it exceeds this
 *  ceiling, mesh + upload pacing DROP to the floor step (1 mesh, ~3 uploads) for the next few frames,
 *  letting frame-time recover before ramping back up.
 *
 *  CEILING CHOICE — set ABOVE one vsync interval (22 ms > 16.6 ms): the frame-dt signal the engine feeds
 *  is wall-clock (rAF-to-rAF), so it INCLUDES vsync idle — a frame doing 8 ms of work but parked to the
 *  60 Hz refresh reports ~16.6 ms. A ceiling below that would false-trip on every healthy vsync-locked
 *  frame and choke the stream (measured: a 13 ms ceiling stuck the post-flight drain throttled for ~14 s).
 *  22 ms clears the single-refresh case + jitter, so it fires ONLY on genuine multi-vsync STALLS — which
 *  is exactly the boot pipeline-compile spike (measured 30-50 ms/frame) we want to smooth. Below this ⇒
 *  full adaptive throughput. Boot's first frame (no reading yet) still starts throttled by construction. */
export const FRAME_GOVERNOR_MS = 22
/** Per-frame GPU-upload byte budget ladder (chunk-equivalents), scaled by the SAME pending depth as
 *  mesh so uploads keep pace with meshing. Bytes = step × DENSE_CHUNK_BYTES. Idle ring → 3 chunks/frame
 *  (the pre-adaptive 32 KB default); heavy backlog → up to 8 chunks/frame. */
export const UPLOAD_BUDGET_STEPS = /** @type {const} */ ([
  [0, 3],
  [32, 4],
  [128, 6],
  [512, 8],
])
/** Nominal bytes for one dense surface chunk (~1300 quads × 8 B) — the unit the upload-budget ladder
 *  multiplies. A round over-estimate so a step of N reliably admits ≥N average chunks. */
export const DENSE_CHUNK_BYTES = 10 * 1024
/** FORWARD-BIAS priority weight (2026-07-03). The player looks where they fly, so within the desired
 *  ring the visible/forward columns should resolve FIRST. Priority = squared distance − bias·(forward
 *  projection of the chunk-offset onto the camera's flat facing). 0 = pure nearest-first (legacy); a
 *  positive value pulls forward columns ahead of equidistant side/rear ones so the on-screen area
 *  detailises first. Units: block². Kept modest so nearest-first still dominates (no starving the
 *  chunk under the player). */
// [D259 — chunks must never visibly load in a ring around the player with nothing resolved directly
// underfoot] The forward-bias is now a BOUNDED intra-ring tiebreak in CHUNK² units (< 1 ring gap of 1), so
// the PRIMARY load order is a pure nearest-first SPIRAL (the under-player chunk, dist²=0, is always
// strictly first) and facing only breaks ties WITHIN a ring. The prior value (3·CHUNK_SIZE² = 3072,
// BLOCK² units) unit-mismatched against dist² (chunk²), making every looked-at chunk ≈ −3000 → the whole
// forward half-plane loaded BEFORE the player's own column. 0 = pure spiral, no facing tiebreak.
export const FORWARD_BIAS_CHUNKS2 = 0.9

// ---- CONFIG-FIRST world recipe (NG1-E) ---------------------------------------------------------
// The full serializable world-gen recipe (every gen tunable in one schema, admin-editable later)
// lives in world_gen_config.js. Re-exported here — additive, no existing export touched — so the
// scalar constants above and the composite recipe share one config entry point. The scalar exports
// stay the single source of truth the LIVE engine reads today; DEFAULT_WORLD_GEN_CONFIG mirrors
// them 1:1 (guarded by world_gen_config.test.js) until the gen lanes migrate to reading the recipe.
export {
  DEFAULT_WORLD_GEN_CONFIG,
  validate_world_gen_config,
  config_hash,
  config_hash_hex,
} from './world_gen_config.js'

/**
 * @typedef {'heat'|'rain'|'continentalness'|'erosion'|'weirdness'|'depth'|'structures'|
 *   'hydrology'|'decorators'|'carvers'|'fight_grid'} SubSeedName
 */

const U64_MASK = (1n << 64n) - 1n
const GOLDEN_GAMMA = 0x9e3779b97f4a7c15n

/**
 * splitmix64 mix step (public-domain algorithm, Vigna). Pure 64-bit integer arithmetic via
 * BigInt — exact and cross-machine portable, satisfying the determinism law (§3.7).
 * @param {bigint} state
 * @returns {bigint} next 64-bit state (masked)
 */
function splitmix64_next(state) {
  return (state + GOLDEN_GAMMA) & U64_MASK
}

/**
 * splitmix64 output mixer — turns a raw state word into a well-distributed 64-bit value.
 * @param {bigint} z
 * @returns {bigint}
 */
function splitmix64_mix(z) {
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & U64_MASK
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & U64_MASK
  return z ^ (z >> 31n)
}

/**
 * Hashes a UTF-8 string into a 64-bit BigInt via FNV-1a (integer-only, deterministic).
 * @param {string} text
 * @returns {bigint}
 */
function fnv1a_64(text) {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash ^ BigInt(text.charCodeAt(i))) & U64_MASK
    hash = (hash * prime) & U64_MASK
  }
  return hash
}

/**
 * Derives a named 32-bit unsigned sub-seed from the master seed string. Same master seed +
 * same name ⇒ same sub-seed on every machine, forever (§3.7 golden-hash contract).
 * @param {string} master_seed
 * @param {SubSeedName | string} name
 * @returns {number} unsigned 32-bit integer sub-seed
 */
export function derive_sub_seed(master_seed, name) {
  const base_state = fnv1a_64(`${master_seed}:${name}`)
  const mixed = splitmix64_mix(splitmix64_next(base_state))
  return Number(mixed & 0xffffffffn) >>> 0
}

/**
 * Builds the full set of named sub-seeds consumed by gen/ (noise fields, structures, fight
 * grids, …) from one master seed. WS2/WS9/WS10 call this once at boot.
 * @param {string} [master_seed]
 * @returns {Record<SubSeedName, number>}
 */
export function derive_world_seeds(master_seed = MASTER_SEED) {
  /** @type {SubSeedName[]} */
  const names = [
    'heat',
    'rain',
    'continentalness',
    'erosion',
    'weirdness',
    'depth',
    'structures',
    'hydrology',
    'decorators',
    'carvers',
    'fight_grid',
  ]
  /** @type {Partial<Record<SubSeedName, number>>} */
  const seeds = {}
  for (const name of names) seeds[name] = derive_sub_seed(master_seed, name)
  return /** @type {Record<SubSeedName, number>} */ (seeds)
}
