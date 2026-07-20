// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Far-section streamer (§11 NG-LOD phase B) — schedules WHICH far sections get built and DISPATCHES the
// builds to a DEDICATED worker pool (far_section_worker.js), uploading each finished FarMesh to the
// far-shell renderer (far_field.js). Implements the Distant-Horizons two-selection flow for GAPLESS,
// coarse-first coverage (design law: "the map should instantly load, even a lower-quality version first"
// — NEVER an empty band between the near ring and the horizon). Each frame:
//   1. KEEP set = select_sections with the REAL is_loaded (the built set). DH parent-substitution: a
//      footprint whose fine sections aren't built yet is covered by its built COARSE ANCESTOR — so a
//      built L4 root spans the whole annulus + horizon from the first frame, making an empty mid-band
//      STRUCTURALLY impossible. far_field renders exactly the keep set (parent leaves the instant its
//      children are all loaded → no overlap, no z-fight).
//   2. BUILD frontier = select_build_frontier with the REAL is_loaded — the sections to DISPATCH next so
//      coverage fills coarsest-first and refines inward. It builds the COARSEST stand-in over any footprint
//      with no cover yet (so a built L4 exists for the keep set to substitute — the annulus is covered from
//      ~frame 1), then refines into children, and asks for NOTHING once a footprint is covered down to
//      target (no build↔prune thrash). This replaces the old "select_sections(is_loaded=()=>true)" ideal
//      tiling, which requested only the finest LEAVES and so never built the coarse substitutes → the
//      near→mid band had no coarse cover and filled last (reported: "huge empty distance, then far LOD chunks").
//   3. PRUNE keep-set drop-outs; UPLOAD finished builds (governed by a per-frame ms slice — the far
//      shell's only render-thread cost); DISPATCH coarsest-first, capped by a per-frame count + an
//      in-flight ceiling.
//
// NO NEAR-STARVATION, so NO queue-gate: the far shell runs on its OWN worker pool, separate from the
// near gen pool — far building physically cannot steal near workers, so builds proceed from frame 0
// (that is what fills the annulus instantly). The near ring keeps MAIN-THREAD priority via the far
// shell's small per-frame upload ms slice. WHY A WORKER (measured): a section downsamples up to 256 chunk-column
// profiles — cold L4 ≈ 550 ms/section (node, this world), far past a splittable main-thread slice;
// on-thread it tanked frame-time to ~6 fps during the fill (proven on screen). Each worker owns one gen
// context + reused column-profile LRU (the phase-A steady-state win).
//
// PURE-ADJACENT: all three.js lives behind the injected far_field handle; the heavy gen/mesh pipeline
// lives in the worker. Deterministic section identity (level,sx,sz) keys everything.

import { create_worker_pool } from '../workers/pool.js'
import { MSG_FAR_SECTION_REQUEST } from '../workers/rpc.js'

import { LOD_MAX_LEVEL, select_sections, select_build_frontier, section_span_meters } from './quadtree.js'

/** @typedef {import('./quadtree.js').Selection} Selection */
/** @typedef {import('../render/far_field.js').FarField} FarField */

/** Default outer reach of the far shell in meters (the quadtree root footprint radius). Sized so the
 *  horizon reads to km scale while keeping the selected-section count (and thus geometry mesh count +
 *  memory) bounded well under the 64 MB cap. ~4 km ≈ the reachable-vista range for the demo world; the
 *  proven sky island at (-3624,-4000) sits ~5.4 km from spawn, so flying toward it brings it inside
 *  this reach within the acceptance's 1-2 km. Tunable via options.far_radius_m. */
export const DEFAULT_FAR_RADIUS_M = 4096
/** Default ceiling on concurrent in-flight section builds across the worker pool. Sized to keep every
 *  worker fed (≈ pool size × 1.5) without buffering a huge stale backlog when the camera warps. */
export const DEFAULT_MAX_IN_FLIGHT = 6
/** Default cap on NEW builds dispatched per idle frame. Dispatch itself is cheap (a worker postMessage),
 *  but bounding it keeps the per-frame scheduling work small and paces the horizon fill smoothly. */
export const DEFAULT_MAX_DISPATCH_PER_FRAME = 4
/** BOOT BURST (ENG-21 LOD-TRIM #3) — front-loads far-shell fill so the map appears to load instantly. For the first frames after a
 *  COLD (re)selection — a fresh streamer, or the built set voided to nothing (biome switch / warp) — the
 *  dispatch + in-flight caps jump so the whole far shell, and above all the fence-adjacent band the player
 *  stares at first, fills fast; then they fall back to the steady trickle (protecting fly frame-time once
 *  the horizon is covered). Sized to saturate the small far worker pool while the loading screen is up. */
export const DEFAULT_BOOT_BURST_FRAMES = 45
export const DEFAULT_BOOT_MAX_DISPATCH_PER_FRAME = 16
export const DEFAULT_BOOT_MAX_IN_FLIGHT = 24
/** Camera move (m) required before the far selections + prune recompute (hysteresis) — between recomputes
 *  the far shell just drains/dispatches from the last target, so a fly doesn't churn far sections every
 *  frame. [ENG-21 LOD-TRIM stability, design ruling 2026-07-07: polygons must stop constantly updating while moving] raised
 *  8→16 m (one full L1 cell of movement) so the level selection recomputes at most every 16 m of travel
 *  instead of ~every frame — the coarse temporal grain that, together with the split/merge dead band
 *  (quadtree.MERGE_HYSTERESIS), stops the shell re-tessellating under continuous motion. Far sections are
 *  distant, so 16 m of selection staleness is invisible; the near voxel ring (its own chunk-boundary
 *  hysteresis) keeps the close band crisp regardless. */
export const SELECT_HYSTERESIS_M = 16
/** COVERAGE-SAFE PRUNE margin (m): a keep-set drop-out whose footprint lies fully beyond
 *  far_radius + this is a true TRAILING exit (off-screen behind the camera) → hard-removed (no visible
 *  fade needed). Every OTHER drop-out (refined-away, or coarsened by distance) is RETIRED with a
 *  cross-fade instead — it keeps rendering (covering) while its already-built replacement fades in over
 *  it, so a swap is never a bare flash frame and the moving frontier never voids (2026-07-04 architect
 *  FIX 1+3: stale-but-covering is correct; the fragment mask stops overlay over near terrain, finer-wins
 *  depth bias handles far-vs-far overlap). One section span at the coarsest level of slack. */
export const PRUNE_TRAIL_MARGIN_M = section_span_meters(4)
/** ADAPTIVE UPLOAD ms BUDGET (S4 — PERF_MOBILE_PLAN §A.5, §B.S4). The far shell's ONLY per-frame
 *  render-thread cost is uploading finished builds: each far_field.upload_section runs a main-thread
 *  BufferGeometry build (far_field.build_section_geometry) whose cost SCALES with the section — a big L4
 *  stand-in expands far more geometry than a small L1. A COUNT budget over that VARIABLE cost is the
 *  diagnosed mobile jank source, so the drain is governed by a WALL-CLOCK slice instead, mirroring the
 *  near ring's MESH_BUDGET_MS (ring_manager.mesh_ready_chunks): measure the clock around each upload,
 *  always land the first, then bail once the slice is spent and CARRY the rest to the next frame. */
/** STEADY per-frame far-upload slice (ms). Matches the near ring's 3 ms base MESH_BUDGET_MS so the two
 *  main-thread producers share the frame-time envelope (a spent far slice + the near slice + ~8 ms render
 *  stays inside 16.6 ms/60fps). The real governor once the horizon is covered. */
export const FAR_UPLOAD_BUDGET_MS = 3
/** BOOT-BURST per-frame far-upload slice (ms) — the ms translation of the old boot-burst dispatch spike
 *  (design law: "the map should instantly load, even a lower-quality version first"). While the shell is
 *  cold/empty (burst_left armed) uploads draw a bigger wall-clock slice so the horizon fills fast; it
 *  steps back to the steady slice the instant the shell is populated. ~8 ms keeps a brisk boot cadence
 *  (a boot frame already shares time with pipeline compiles) without a single long jank frame. */
export const FAR_UPLOAD_BUDGET_BOOT_MS = 8
/** SECONDARY count rail on uploads/frame — NOT the governor (the ms slice above is). A hard ceiling so a
 *  pathological run of ~0-cost uploads (e.g. all-empty sections) can't spin the drain unbounded in one
 *  frame; set well above what either ms slice admits at real per-section cost, so it never throttles the
 *  fill. A caller may pin max_uploads_per_frame to a lower FIXED count (tests). */
export const FAR_UPLOAD_MAX_PER_FRAME = 32

/**
 * @typedef {object} FarStreamerOptions
 * @property {FarField} far_field the far-shell renderer (upload/remove/has target).
 * @property {string} [seed] world seed for the far worker's gen context (defaults to the gen default).
 * @property {number} [far_radius_m] outer far-shell reach in meters (default DEFAULT_FAR_RADIUS_M).
 * @property {number} [max_in_flight] max concurrent in-flight section builds (default
 *   DEFAULT_MAX_IN_FLIGHT).
 * @property {number} [max_dispatch_per_frame] max NEW builds dispatched per idle frame (default
 *   DEFAULT_MAX_DISPATCH_PER_FRAME).
 * @property {number} [boot_burst_frames] frames the BOOT BURST stays armed after a cold (re)selection
 *   before it falls back to the steady caps (default DEFAULT_BOOT_BURST_FRAMES; 0 disables the burst).
 * @property {number} [boot_max_dispatch_per_frame] dispatch cap DURING the boot burst (default
 *   DEFAULT_BOOT_MAX_DISPATCH_PER_FRAME).
 * @property {number} [boot_max_in_flight] in-flight ceiling DURING the boot burst (default
 *   DEFAULT_BOOT_MAX_IN_FLIGHT).
 * @property {number} [max_uploads_per_frame] FIXED count cap on finished builds uploaded per frame,
 *   OVERRIDING the per-frame ms slice. OMIT in production so the wall-clock slice (FAR_UPLOAD_BUDGET_MS /
 *   FAR_UPLOAD_BUDGET_BOOT_MS) governs the variable-cost geometry builds; tests pin it to assert an exact
 *   per-frame count.
 * @property {() => number} [now] injectable monotonic clock (ms) for the upload ms slice; defaults to
 *   performance.now (Date.now headless fallback). Tests inject a fake clock to drive the budget.
 * @property {(level:number, sx:number, sz:number) => Promise<import('./far_mesher.js').FarMesh>}
 *   [submit_build] SEAM: async section-build submitter. Production injects one backed by the shared far
 *   worker pool (engine-owned); tests inject a synchronous stub so they exercise the schedule WITHOUT a
 *   worker or the world generator. Defaults to a self-owned single dedicated far worker.
 * @property {boolean} [refine_lod] false builds only coarse L4 coverage roots (`?no_lod_refine=1`).
 * @property {() => void} [on_lod_promotion] hook when a finer upload lands over a built ancestor.
 */

/**
 * @typedef {object} FarStreamer
 * @property {(state: FarUpdateState) => void} update advances the far stream for one frame: computes the
 *   DH keep set (coverage, with coarse substitutes) + the ideal build target, prunes keep-set drop-outs,
 *   drains finished builds (throttled), and dispatches new builds coarsest-first (count- + in-flight-
 *   capped) on the dedicated far pool. Cheap every frame (the heavy build is off-thread).
 * @property {() => number} section_count resident far sections (built + rendered).
 * @property {() => number} bytes total resident far geometry bytes (from far_field).
 * @property {() => number} pending_count selected-but-not-yet-built sections at the last update (the
 *   horizon still filling in) — for the perf report / HUD.
 * @property {() => void} dispose drops the gen context references (no GPU state here — far_field owns
 *   the meshes; engine.js disposes it separately).
 */

/**
 * @typedef {object} FarUpdateState per-frame inputs from engine.js.
 * @property {[number, number]} camera_xz camera world [x, z] in meters.
 * @property {number} near_radius_m inner radius (meters) the near voxel ring covers — sections whose
 *   footprint is entirely inside this are exempted (ring_manager.loaded_radius_blocks()). Pass the
 *   RESIDENT loaded radius so the far shell covers any not-yet-streamed near area (coarse under detail).
 */

/** @param {number} level @param {number} sx @param {number} sz @returns {string} section id key */
function section_id(level, sx, sz) {
  return `${level},${sx},${sz}`
}

/**
 * Whether a section id's world footprint lies FULLY beyond `far_radius_m + PRUNE_TRAIL_MARGIN_M` from the
 * camera (max-norm) — a true trailing exit (off-screen behind the camera), safe to hard-remove without a
 * cross-fade. A drop-out that is NOT trailing is being replaced in-place (finer children / coarser
 * ancestor already rendering) and must cross-fade instead. Pure.
 * @param {string} id `level,sx,sz` @param {number} cam_x @param {number} cam_z camera world XZ
 * @param {number} far_radius_m @returns {boolean}
 */
export function section_is_trailing(id, cam_x, cam_z, far_radius_m) {
  const [level, sx, sz] = id.split(',').map(Number)
  const span = section_span_meters(level)
  const x0 = sx * span
  const z0 = sz * span
  // Max-norm distance from the camera to the NEAREST point of the footprint (0 if inside).
  const dx = Math.max(x0 - cam_x, 0, cam_x - (x0 + span))
  const dz = Math.max(z0 - cam_z, 0, cam_z - (z0 + span))
  return Math.max(dx, dz) > far_radius_m + PRUNE_TRAIL_MARGIN_M
}

/**
 * Creates the far-section streamer. Dispatches section builds to an injected async `submit_build`
 * (the far worker pool in production; a synchronous stub in tests) and uploads results to far_field.
 * Deterministic scheduling (same seed + camera + built set ⇒ same dispatch order).
 * @param {FarStreamerOptions} options
 * @returns {FarStreamer}
 */
export function create_far_streamer({
  far_field,
  seed,
  far_radius_m = DEFAULT_FAR_RADIUS_M,
  max_in_flight = DEFAULT_MAX_IN_FLIGHT,
  max_dispatch_per_frame = DEFAULT_MAX_DISPATCH_PER_FRAME,
  boot_burst_frames = DEFAULT_BOOT_BURST_FRAMES,
  boot_max_dispatch_per_frame = DEFAULT_BOOT_MAX_DISPATCH_PER_FRAME,
  boot_max_in_flight = DEFAULT_BOOT_MAX_IN_FLIGHT,
  max_uploads_per_frame,
  now = default_now,
  submit_build = default_submit_build(seed),
  refine_lod = true,
  on_lod_promotion,
}) {
  // UPLOAD PACING: the drain is governed by a per-frame WALL-CLOCK slice (FAR_UPLOAD_BUDGET_MS steady /
  // FAR_UPLOAD_BUDGET_BOOT_MS while cold) because each upload's geometry build is VARIABLE-cost — a
  // count budget over it was the mobile jank source. A caller MAY pin max_uploads_per_frame to a FIXED
  // count (tests assert an exact per-frame count); production leaves it unset so the ms slice governs,
  // with FAR_UPLOAD_MAX_PER_FRAME as a secondary rail.
  const fixed_uploads = max_uploads_per_frame
  /** Built + rendered section ids (uploaded to far_field). @type {Set<string>} */
  const built = new Set()
  /** Sections dispatched to a worker, awaiting a result. @type {Set<string>} */
  const in_flight = new Set()
  /** Finished builds waiting to be uploaded, drained under a per-frame ms slice (upload = a main-thread
   *  BufferGeometry build + scene add — the far shell's only per-frame render-thread cost, ms-budgeted
   *  like the near ring's MESH_BUDGET_MS to keep fly frames smooth).
   *  @type {{ id: string, mesh: import('./far_mesher.js').FarMesh }[]} */
  const ready = []
  /** Ids currently in `ready` (finished, awaiting upload) — so they aren't re-dispatched or counted
   *  missing while queued. @type {Set<string>} */
  const queued = new Set()
  /** The current frame's target id set — a resolving build checks membership here before queueing, so
   *  a section pruned while its build was in flight is DROPPED (no stale upload). @type {Set<string>} */
  /** Latest BUILD-target id set — a resolving build may upload if EITHER this or the keep set wants it
   *  (a just-built coarse coverage root, or a finer section). @type {Set<string>} */
  let build_ids = new Set()
  let target_ids = new Set() // = the keep set ids (coverage: substitutes + finest built)
  let pending_count = 0
  let disposed = false
  // SELECTION HYSTERESIS: the two DH selections + prune only RECOMPUTE when the camera has moved
  // ≥ SELECT_HYSTERESIS_M since the last recompute (or the near radius changed). Between recomputes we
  // still drain uploads + dispatch from the last target — so far sections don't re-select/prune/re-
  // dispatch every frame during a fly (the churn that spiked fly-p99). Far sections are distant, so a
  // few metres of staleness is invisible; this mirrors the near ring's chunk-boundary hysteresis.
  let last_sel_x = Number.NaN
  let last_sel_z = Number.NaN
  let last_near_radius = -1
  // BOOT BURST: frames still armed. Starts armed so the cold first-boot fill bursts; re-armed on any
  // later cold (re)selection (the built set voided to nothing — biome switch / warp-to-void); decremented
  // each frame until it hits 0, then dispatch falls back to the steady trickle caps.
  let burst_left = boot_burst_frames

  /** Real is_loaded predicate for select_sections: is this exact (level,sx,sz) section built + rendered?
   *  @type {import('./quadtree.js').LoadedPredicate} */
  const id_loaded = (level, sx, sz) => built.has(section_id(level, sx, sz))

  /** @param {string} id @param {number} cam_x @param {number} cam_z */
  const is_trailing = (id, cam_x, cam_z) => section_is_trailing(id, cam_x, cam_z, far_radius_m)

  /** @param {string} id @returns {boolean} */
  function has_coarse_ancestor(id) {
    let [level, sx, sz] = id.split(',').map(Number)
    while (level < LOD_MAX_LEVEL) {
      level += 1
      sx = Math.floor(sx / 2)
      sz = Math.floor(sz / 2)
      if (built.has(section_id(level, sx, sz))) return true
    }
    return false
  }

  /**
   * Dispatches one section build to the worker; on resolve QUEUES it for upload IF still wanted (by the
   * keep-set coverage OR the build target).
   * @param {Selection} sel
   */
  function dispatch(sel) {
    const id = section_id(sel.level, sel.sx, sel.sz)
    in_flight.add(id)
    submit_build(sel.level, sel.sx, sel.sz).then(
      (mesh) => {
        in_flight.delete(id)
        if (disposed) return
        if (!target_ids.has(id) && !build_ids.has(id)) return // no longer wanted → drop
        ready.push({ id, mesh })
        queued.add(id)
      },
      () => {
        // Build failed / worker backpressure: forget it so a later frame re-dispatches.
        in_flight.delete(id)
      }
    )
  }

  /** Drains finished builds to far_field under a per-frame WALL-CLOCK slice — the variable-cost geometry
   *  build is the far shell's only render-thread cost. Mirrors ring_manager.mesh_ready_chunks: measure
   *  the slice, upload the first for free, then check the deadline BETWEEN uploads (never mid-build) and
   *  CARRY the rest to the next frame. A bigger slice while the shell is cold (bursting) fills the horizon
   *  fast, stepping down to the steady slice once populated. FAR_UPLOAD_MAX_PER_FRAME is a secondary rail;
   *  a caller-pinned fixed count overrides both. Uploads a build if the keep set OR the build target still
   *  wants it (coverage root or finer section); drops the rest.
   *  @param {Set<string>} wanted_build the current build-target id set @param {boolean} bursting */
  function drain_uploads(wanted_build, bursting) {
    const budget_ms = bursting ? FAR_UPLOAD_BUDGET_BOOT_MS : FAR_UPLOAD_BUDGET_MS
    const cap = fixed_uploads !== undefined ? fixed_uploads : FAR_UPLOAD_MAX_PER_FRAME
    const start = now()
    let uploaded = 0
    while (ready.length > 0 && uploaded < cap) {
      // Deadline BETWEEN uploads (one always lands): bail once this frame's far slice is spent and carry
      // the rest to the next frame. Dropped (no-longer-wanted) sections cost ~nothing and don't count.
      if (uploaded > 0 && now() - start >= budget_ms) break
      const { id, mesh } = /** @type {{id:string, mesh:import('./far_mesher.js').FarMesh}} */ (ready.shift())
      queued.delete(id)
      if (!target_ids.has(id) && !wanted_build.has(id)) continue // no longer wanted — drop
      if (on_lod_promotion && has_coarse_ancestor(id)) on_lod_promotion()
      far_field.upload_section(id, mesh)
      built.add(id)
      uploaded += 1
    }
  }

  /** Cached ideal BUILD target (the finest disjoint tiling), sorted coarsest-first for dispatch —
   *  recomputed only on a hysteresis boundary (below). @type {Selection[]} */
  let build_target_sorted = []
  /** Last built-set size at a reselect — a change means a section landed/pruned, so the DH keep-set
   *  substitution must refresh (a parent may now drop for its finished children). */
  let last_built_size = -1

  return {
    update({ camera_xz, near_radius_m }) {
      if (disposed) return

      // HYSTERESIS: recompute the two DH selections + prune only when the camera moved ≥
      // SELECT_HYSTERESIS_M, OR the near radius changed, OR the built set changed (a section landed/
      // pruned → the parent-substitution keep set must refresh). Otherwise reuse the cached target and
      // just drain/dispatch — so a fly doesn't re-select/prune every frame (the fly-p99 churn).
      const [cx, cz] = camera_xz
      const moved = Number.isNaN(last_sel_x) || Math.hypot(cx - last_sel_x, cz - last_sel_z) >= SELECT_HYSTERESIS_M
      // ANCHOR CAMERA (reported 07-07: "polygons constantly updating while moving"): the DH walks run at an
      // ANCHOR that advances ONLY on a real ≥SELECT_HYSTERESIS_M move — NOT the live camera. Before, the
      // built-set-changed trigger fired every frame during a fly (sections land continuously) and re-
      // anchored to the live camera each time, so the level selection re-derived from the moving camera
      // every frame → the constant re-tessellation. Now a build landing still re-walks (to swap a coarse
      // substitute for its freshly-built children — refinement, not churn) but AT THE FROZEN ANCHOR, so
      // level transitions happen at most once per 16 m of travel. Advance the anchor only when `moved`.
      if (moved) {
        last_sel_x = cx
        last_sel_z = cz
      }
      const reselect = moved || near_radius_m !== last_near_radius || built.size !== last_built_size

      if (reselect) {
        last_near_radius = near_radius_m
        last_built_size = built.size
        const anchor = /** @type {[number, number]} */ ([last_sel_x, last_sel_z])

        // (A) KEEP/RENDER set — select with the REAL is_loaded. DH parent-substitution: a footprint
        //     whose fine sections aren't built yet is covered by its built COARSE ANCESTOR, so a built
        //     L4 root spans the whole annulus + horizon → an empty mid-band is STRUCTURALLY impossible.
        //     far_field renders exactly this set (parent leaves the instant its children all load → no
        //     overlap/z-fight). Design law: "the map should instantly load, even a lower-quality first."
        //     Anchored camera (not live) so the level split/merge is frozen between 16 m steps.
        const keep = select_sections({ camera_xz: anchor, near_radius_m, far_radius_m, is_loaded: id_loaded })
        target_ids = new Set(keep.map((s) => section_id(s.level, s.sx, s.sz)))

        // (B) BUILD frontier — the coarsest-uncovered-first refinement set against the REAL built set.
        //     Dispatch coarsest-first (then near-first) so a coarse L4 stand-in covers each footprint
        //     before any of it refines → the near→mid band is covered from ~frame 1, never empty. Emits
        //     only not-yet-built sections, and nothing once a footprint is covered down to target (so a
        //     pruned substitute is never rebuilt). Also BOOTSTRAPS the cold start (roots first).
        let build_target = select_build_frontier({
          camera_xz: anchor,
          near_radius_m,
          far_radius_m,
          is_loaded: id_loaded,
        })
        if (!refine_lod) build_target = build_target.filter((section) => section.level === LOD_MAX_LEVEL)
        build_ids = new Set(build_target.map((s) => section_id(s.level, s.sx, s.sz)))
        // DISPATCH ORDER — NEAR-FIRST refinement (ENG-21 P0, owner border reject: "the LOD isn't detailed
        // at the fence"). The frontier still emits coarse stand-ins BEFORE a footprint refines (gapless per
        // footprint — subtree_has_built guards it), but the GLOBAL order is now nearest-footprint-first:
        // the band the player stares at (just past the near ring / zone fence) climbs L4→L1 to its finest
        // voxel level FIRST, instead of the old coarsest-LEVEL-first pass that refined every distant L2
        // before any near L1 (measured: near fence stayed smooth ~25 s after a refresh — 11 built at t3 s,
        // 514 at plateau). Coarse-as-tiebreak keeps each footprint's own cover-before-refine ordering.
        build_target_sorted = build_target.sort((a, b) => a.dist2 - b.dist2 || b.level - a.level)

        // BOOT BURST re-arm: a COLD (re)selection — nothing built yet but there IS a target (fresh
        // streamer, or the built set voided by a biome switch / warp) — re-arms the burst so the shell
        // refills fast. A steady fly (built set intact) never re-arms, so the burst stays a boot-only spike.
        if (built.size === 0 && build_target_sorted.length > 0) burst_left = boot_burst_frames

        // PRUNE built sections the keep set no longer wants. COVERAGE-SAFE (architect FIX 1+3): a
        // TRAILING drop-out (footprint fully beyond far_radius + margin, i.e. off-screen behind the
        // camera) is HARD-removed; every other drop-out (refined into finer children, or coarsened by
        // distance) is RETIRED with a cross-fade — it keeps rendering (covering) while its already-built
        // replacement fades in, so the moving frontier never voids and a swap never flashes. `built`
        // drops immediately either way (section_count stays truthful; the fade lives in far_field).
        for (const id of [...built]) {
          if (target_ids.has(id)) continue
          if (is_trailing(id, cx, cz)) far_field.remove_section(id)
          else far_field.retire_section(id)
          built.delete(id)
        }
      }

      // BOOT-BURST state for THIS frame — drives BOTH the upload ms slice (a bigger wall-clock budget
      // while the shell is cold/empty) and the dispatch/in-flight caps (saturate the pool while cold).
      // Decremented once, after both consumers below.
      const bursting = burst_left > 0

      // UPLOAD finished builds under the per-frame ms slice (the far shell's only render-thread cost) —
      // every frame. Accept a build if the keep set OR the build target still wants it (a coverage root
      // or a finer section on its way in).
      drain_uploads(build_ids, bursting)

      // DISPATCH coarsest-first toward the cached ideal tiling — every frame, on the OWN dedicated worker
      // pool (can't starve the near gen pool; near keeps main-thread priority via the far shell's small
      // per-frame upload ms slice). Coverage roots first → annulus covered immediately, no radial hole.
      // Count- + in-flight-capped.
      let not_rendered = 0
      for (const s of build_target_sorted) if (!built.has(section_id(s.level, s.sx, s.sz))) not_rendered += 1
      pending_count = not_rendered

      // BOOT BURST caps: while armed (a cold (re)selection filling), dispatch + saturate the pool hard so
      // the fence band is refined before the player looks; once burst_left drains, trickle at the steady
      // caps (fly frame-time guard). The in-flight ceiling is still a HARD cap — just a higher one here.
      const eff_dispatch = bursting ? boot_max_dispatch_per_frame : max_dispatch_per_frame
      const eff_in_flight = bursting ? boot_max_in_flight : max_in_flight
      if (bursting) burst_left -= 1

      let dispatched = 0
      for (const s of build_target_sorted) {
        if (dispatched >= eff_dispatch) break
        if (in_flight.size >= eff_in_flight) break
        const id = section_id(s.level, s.sx, s.sz)
        if (built.has(id) || in_flight.has(id) || queued.has(id)) continue
        dispatch(s)
        dispatched += 1
      }
    },

    section_count() {
      return built.size
    },

    bytes() {
      return far_field.bytes()
    },

    pending_count() {
      return pending_count
    },

    dispose() {
      disposed = true
      built.clear()
      in_flight.clear()
      ready.length = 0
      queued.clear()
      target_ids = new Set()
    },
  }
}

/**
 * The default async build submitter — routes to the far-section worker pool (created here so engine.js
 * only wires the streamer). Each build resolves with a FarMesh. NOTE: production ALWAYS injects a
 * `submit_build` backed by the shared pool (so worker count + backpressure are engine-owned); this
 * fallback exists only so a bare `create_far_streamer({ far_field, seed })` still works (single
 * dedicated worker), and keeps the seed→worker wiring in one place.
 * @param {string} [seed]
 * @returns {(level:number, sx:number, sz:number) => Promise<import('./far_mesher.js').FarMesh>}
 */
function default_submit_build(seed) {
  /** @type {import('../workers/pool.js').WorkerPool | null} */
  let pool = null
  return (level, sx, sz) => {
    if (!pool) {
      pool = create_worker_pool({
        create_worker: () => new Worker(new URL('./far_section_worker.js', import.meta.url), { type: 'module' }),
        worker_count: 1,
        max_queue_depth: 512,
      })
    }
    return /** @type {Promise<import('./far_mesher.js').FarMesh>} */ (
      pool.submit(MSG_FAR_SECTION_REQUEST, { level, sx, sz, seed })
    )
  }
}

/** Default clock: performance.now when present (browser), else Date.now (headless test fallback). */
function default_now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}
