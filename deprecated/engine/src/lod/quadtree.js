// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Far-shell LOD quadtree + per-frame selection (§11 NG-LOD, survey S1) — the Distant Horizons
// selection state machine, ported wholesale. A single square quadtree tiles the XZ plane in FAR
// sections (section_builder.js). Each node owns ONE fixed-resolution 32×32 section; only its world
// footprint grows per level (2:1), so the finest visible level near the camera is L1 (2 m cells) and
// the coarsest at the horizon is L4 (16 m cells). Selection walks the tree once per frame from the
// camera and emits the set of (section grid pos, level) to render.
//
// THREE-WAY DH NODE OUTCOME (LodQuadTree.java L509-643) — the whole algorithm:
//   want = target_level(dist)                              log-distance desired detail at this node
//   (1) node.level  > want  AND node can subdivide   → RECURSE into its 4 children (need finer)
//   (2) node.level <= want                            → this node is fine ENOUGH → try to render it,
//                                                        BUT only if its section is loaded; else…
//   (3) children requested but not all loaded         → PARENT KEEPS RENDERING (render-parent-while-
//                                                        children-load) → hole-free streaming, our
//                                                        horizon pop answer (C6 at distance).
//
// CRACK-FREE INVARIANT (survey S3 rationale, enforced structurally + tested): two ADJACENT visible
// sections differ by ≤1 level. The log-distance target is 1-Lipschitz in ring-distance so the
// selection naturally clamps neighbor deltas to ≤1; far_mesher's box-column skirts then paper any
// residual 1-level seam. `assert_crack_free()` is the invariant the test battery hammers.
//
// SCALE: this module is PURE data — camera in, (section,level) set out. No three.js, no GPU, no
// section building (the caller pairs each selected entry with a build_section result). Deterministic:
// same camera + same loaded set ⇒ same selection.
//
// ============================================================================================
// PHASE-B INTEGRATION SPEC (rendering wiring — DO NOT implement here; this is the contract the
// NG-LOD render wave consumes; every named symbol below is verified to exist on disk today).
// --------------------------------------------------------------------------------------------
// 1. POOL RECORD MAPPING (the 8-byte quad record + the 2-bit LOD SCALE bits).
//    The far mesh (far_mesher.js) emits quads in the SAME frozen 8-byte layout as near terrain
//    (src/mesh/quad_buffer.js encode_quad). RESERVED BITS available for LOD (additive, freeze-legal
//    per survey S20 — zero existing bits move):
//        word_a bit 31            : 1 reserved bit (currently unused)
//        word_b bits 28..31       : 4 reserved bits (currently unused)
//    NG-LOD claims word_b bits 28..29 as a 2-bit `lod_scale` = log2(cell_meters): 0→1× 1→2× 2→4×
//    3→8× (the survey S20 rowannadon 1/2/4/8× scheme; our far levels L1..L4 map to scale 1..3 since
//    L1's cell is 2 m = scale 1). The vertex shader multiplies the unit-quad footprint by
//    (1<<lod_scale) so mixed-resolution far quads live in ONE mega pool buffer with the near terrain
//    — no separate pipeline. word_b bits 30..31 + word_a bit 31 stay reserved. far_mesher.js already
//    packs this field (see FAR_LOD_SCALE_SHIFT there); terrain_material.js's TSL decode must add the
//    matching `let scale = (b >> 28u) & 0x3u; footprint *= f32(1u << scale);` and gate it so near
//    chunks (scale 0) are unaffected.
//    Upload seam: create_terrain_renderer.upload_chunk(coord, quad_buffer, quad_count) in
//    src/render/pool_renderer.js — far sections upload through the SAME call as chunks (a section's
//    grid pos maps to a synthetic ChunkCoord). partition_quads() there routes far quads to the
//    'solid' class (far foliage is tinted-into-surface per survey S4, never its own geometry).
//    The color per quad is the section's dominant map_color (colors.js get_map_color /
//    build_map_color_lut) written into the record's block_id → the far shader resolves RGB from the
//    same map-color LUT uploaded as a small uniform.
//
// 2. AERIAL-HAZE FOG HANDOFF (the far shell dissolves into the sky; survey S5).
//    The near terrain already fogs via src/core/renderer.js: `scene.fog = new Fog(FOG_COLOR,
//    FOG_NEAR=200, FOG_FAR=900)` and the clamp entry `set_fog_far_ceiling(ceiling_m)` (renderer.js
//    ~L390), fed each frame in engine.js by `ring_manager.fog_far_ceiling_m()`. NG-LOD extends the
//    handoff:
//      • The near ring's fog FAR (currently the horizon at ~900 m) becomes the far shell's fog NEAR
//        — the far mesh begins exactly where near terrain finishes hazing, so the seam is invisible.
//        Wire: pass ring_manager.loaded_radius_blocks() (the streamed near edge) as the far-fog near.
//      • The far shell's own fog FAR extends to the quadtree's outer radius (root footprint edge),
//        and its far color = the sky node sampled in the view direction (survey S5(ii); the analytic
//        sky lives in src/render/sky/sky_node.js) so the horizon dissolves into sky, not a wall.
//      • Vertex-sink the far mesh near the seam (survey S5(i): `worldPos.y -= max(0, mix(5,0,dist))`)
//        so ordinary depth-test vs near chunks hides the boundary — done in terrain_material.js when
//        it sees lod_scale>0.
//    All three are RENDER-side; this module only tells the renderer WHICH sections exist at WHAT
//    level via select() so the fog math knows the near/far radii.
//
// 3. STREAMING PRIORITY (which sections to build first, under an idle budget).
//    select() returns entries already sorted NEAR-first (ascending ring distance) so the render wave
//    builds/upload the closest missing far sections before distant ones — mirroring ring_manager.js's
//    nearest-first gen/upload policy. The near voxel ring (ring_manager) always wins the frame budget;
//    far-section building is an IDLE-BUDGET task (build the next N missing selected sections only when
//    the near upload_queue is drained — read ring_manager.queue_depth()===0 before spending far budget).
//    render-parent-while-children-load (outcome 3 above) guarantees a parent section already covers any
//    not-yet-built child, so deferring far builds NEVER shows a hole.
// ============================================================================================

/** Finest / coarsest far-LOD level (must match section_builder.js). */
export const LOD_MIN_LEVEL = 1
export const LOD_MAX_LEVEL = 4
/** Cells per section edge (must match section_builder.js CELLS_PER_SECTION). */
export const CELLS_PER_SECTION = 32

/**
 * Restricted-quadtree split factor: a node subdivides while the camera is within SPLIT_FACTOR · span
 * of the node's NEAREST POINT (max-norm). This proximity rule — not the log-distance helper below — is
 * what STRUCTURALLY guarantees the 2:1 balance (edge-adjacent nodes differ by ≤1 level). Intuition: an
 * edge-adjacent coarser neighbor of a subdivided node is only span(L) farther from the camera than the
 * node; with a ≥1 factor that extra distance can push it up at most one split threshold, never two.
 * ≥2 gives comfortable margin (and a finer near-field). Bumping it just widens each level's ring.
 */
export const SPLIT_FACTOR = 2

/**
 * [ENG-21 LOD-TRIM #stability, design ruling 2026-07-07: LOD polygons must not seem to be constantly
 * updating while moving] SPLIT/MERGE DEAD BAND. The bare `nearest < SPLIT_FACTOR·span` threshold has no hysteresis,
 * so a footprint sitting at a level-boundary distance FLICKERS between two levels as the camera jitters
 * across it — the visible re-tessellation that was rejected. We split the threshold into two:
 *   • BUILD frontier subdivides at the tight `SPLIT_FACTOR·span` (only fetch finer detail when clearly wanted),
 *   • KEEP/RENDER walk subdivides at the wider `SPLIT_FACTOR·MERGE_HYSTERESIS·span` — so a footprint already
 *     showing finer detail STAYS finer until the camera pulls a full dead band past the split distance
 *     before it merges back to coarse. Crossing a boundary is therefore a ONE-WAY latch per direction (split
 *     approaching, merge only well past), never a per-frame flip. Both walks use ONE factor internally, so the
 *     2:1 balanced-tree / crack-free invariant is preserved (the proof only needs factor ≥ 1). Reference example
 *     was 1.3× (split at d<X, merge at d>X·1.3). Cost: a thin annulus renders one level coarser while the
 *     camera lingers in the dead band — imperceptible next to killing the flicker, and it moves with the camera.
 */
export const MERGE_HYSTERESIS = 1.3
/** The KEEP/RENDER walk's split factor (wider than the build factor by the dead band — see MERGE_HYSTERESIS). */
export const KEEP_SPLIT_FACTOR = SPLIT_FACTOR * MERGE_HYSTERESIS

/**
 * Log-distance target detail level (DH `LodUtil.getMaxDetailInRange`, L1108-1127): the level whose
 * section footprint is "small enough" for a camera at `dist_m`. Grows by ~1 level per doubling of
 * distance past the first far ring, clamped to [LOD_MIN_LEVEL, LOD_MAX_LEVEL]. Retained as the public
 * "what level does this distance want" oracle (used to reason about / test the ring structure); the
 * actual selection walk uses the SPLIT_FACTOR proximity rule (`should_subdivide`) so the crack-free
 * invariant is enforced by construction rather than relying on this being 1-Lipschitz at ring seams.
 *
 * `unit_span` = the L1 section footprint in meters (32·2 = 64). At distance ≤ unit_span we still want
 * L1; each further doubling bumps the level by one.
 * @param {number} dist_m camera→section distance (meters)
 * @param {number} unit_span L1 section span in meters (section_span_meters(LOD_MIN_LEVEL))
 * @returns {number} target level in [LOD_MIN_LEVEL, LOD_MAX_LEVEL]
 */
export function target_level(dist_m, unit_span) {
  // [D183] Quality must stay high for nearby chunks and fall off rapidly with distance — the finest level now
  // holds for TWO unit spans (a wider high-quality near band), then levels advance per span-doubling as
  // before — the eye meets fine shell where it can inspect it and coarse shell only under haze.
  if (dist_m <= unit_span * 2) return LOD_MIN_LEVEL
  const rings = Math.floor(log2_int(Math.floor(dist_m / (unit_span * 2))))
  const level = LOD_MIN_LEVEL + rings
  if (level < LOD_MIN_LEVEL) return LOD_MIN_LEVEL
  if (level > LOD_MAX_LEVEL) return LOD_MAX_LEVEL
  return level
}

/**
 * Max-norm (Chebyshev) distance from a point to a node's footprint (0 inside). Using max-norm (not
 * Euclidean) is what makes the split rule produce a clean square-ring balanced tree.
 * @param {number} px @param {number} pz point (camera) world XZ
 * @param {number} x0 @param {number} z0 footprint min corner
 * @param {number} span footprint edge
 * @returns {number} chebyshev distance to the nearest point of the footprint (meters)
 */
function cheby_dist_to_box(px, pz, x0, z0, span) {
  const dx = Math.max(x0 - px, 0, px - (x0 + span))
  const dz = Math.max(z0 - pz, 0, pz - (z0 + span))
  return Math.max(dx, dz)
}

/**
 * Whether a node at `level` should subdivide toward finer detail: the camera is close enough (within
 * SPLIT_FACTOR · span of its nearest point) AND the node isn't already at the finest level.
 * @param {number} level @param {number} span @param {number} nearest_dist chebyshev cam→footprint
 * @param {number} [split_factor] proximity multiple that triggers a split — SPLIT_FACTOR for the BUILD
 *   walk, the wider KEEP_SPLIT_FACTOR for the KEEP/RENDER walk (the split/merge dead band; see MERGE_HYSTERESIS)
 * @returns {boolean}
 */
function should_subdivide(level, span, nearest_dist, split_factor = SPLIT_FACTOR) {
  return level > LOD_MIN_LEVEL && nearest_dist < split_factor * span
}

/**
 * Integer floor(log2(n)) for n≥1 via bit position — no Math.log (avoids transcendental drift, keeps
 * the selection deterministic/portable per §3.7). log2_int(1)=0, log2_int(2..3)=1, log2_int(4..7)=2…
 * @param {number} n integer ≥ 1
 * @returns {number}
 */
export function log2_int(n) {
  let v = n | 0
  if (v < 1) return 0
  let r = 0
  while (v > 1) {
    v >>= 1
    r += 1
  }
  return r
}

/** Section span (footprint edge) in meters at a level: 32·2^level. @param {number} level @returns {number} */
export function section_span_meters(level) {
  return CELLS_PER_SECTION * (1 << level)
}

/**
 * @typedef {object} Selection one selected far section to render.
 * @property {number} level LOD level in [LOD_MIN_LEVEL, LOD_MAX_LEVEL]
 * @property {number} sx section grid x AT THIS LEVEL (world origin_x = sx·span)
 * @property {number} sz section grid z AT THIS LEVEL
 * @property {number} span section footprint edge in meters (32·2^level)
 * @property {number} center_x world-x of the section center (meters)
 * @property {number} center_z world-z of the section center (meters)
 * @property {number} dist2 squared camera→center horizontal distance (meters²) — the near-first sort key
 * @property {boolean} substitute true ⇒ this coarse section is standing in for finer children that
 *   are not yet loaded (DH render-parent-while-children-load); false ⇒ it is at its own target level
 */

/** @typedef {(level:number, sx:number, sz:number) => boolean} LoadedPredicate is this section built? */

/**
 * @typedef {object} SelectOptions
 * @property {[number, number]} camera_xz camera world position [x, z] in meters (y is irrelevant to
 *   the XZ quadtree selection)
 * @property {number} near_radius_m inner radius (meters): sections whose center is CLOSER than this
 *   are covered by the NEAR voxel ring (ring_manager), so the far shell skips them (no double render).
 *   Pass ring_manager.loaded_radius_blocks().
 * @property {number} far_radius_m outer radius (meters): the quadtree's reach — sections beyond this
 *   are past the horizon and skipped. Defines the root footprint.
 * @property {LoadedPredicate} [is_loaded] whether a given (level,sx,sz) section is built. Omit (or
 *   always-true) for pure geometric selection (tests/priming); supply the real predicate at runtime so
 *   outcome (3) substitutes a loaded parent for unloaded children.
 */

/**
 * Selects the far sections to render for one camera position — the per-frame DH walk. Returns entries
 * sorted NEAR-first (ascending dist2) so the caller builds/uploads closest sections first (streaming
 * priority, see the phase-B spec). Pure + deterministic.
 *
 * Walk: start at the coarsest level (LOD_MAX_LEVEL) covering [−far_radius, far_radius]² around the
 * camera; for each candidate section decide via the three-way DH outcome whether to recurse to finer
 * children or accept it. A section is accepted at level L when target_level(dist) ≥ L (coarse enough)
 * OR (finer wanted but this-or-a-descendant isn't loaded → substitute the loaded ancestor).
 * @param {SelectOptions} options
 * @returns {Selection[]}
 */
export function select_sections({ camera_xz, near_radius_m, far_radius_m, is_loaded }) {
  const [cam_x, cam_z] = camera_xz
  const loaded = is_loaded ?? (() => true)
  /** @type {Selection[]} */
  const out = []

  // Coarsest-level section-grid window covering the far disc around the camera.
  const root_span = section_span_meters(LOD_MAX_LEVEL)
  const min_sx = Math.floor((cam_x - far_radius_m) / root_span)
  const max_sx = Math.floor((cam_x + far_radius_m) / root_span)
  const min_sz = Math.floor((cam_z - far_radius_m) / root_span)
  const max_sz = Math.floor((cam_z + far_radius_m) / root_span)

  // KEEP/RENDER walk uses the WIDER KEEP_SPLIT_FACTOR — a footprint already refined stays refined across
  // the dead band before merging back to coarse, so movement never flickers a section between levels
  // (reported 07-07). The build frontier uses the tight SPLIT_FACTOR, so only the leading edge fetches finer.
  for (let sz = min_sz; sz <= max_sz; sz += 1) {
    for (let sx = min_sx; sx <= max_sx; sx += 1) {
      visit(LOD_MAX_LEVEL, sx, sz, cam_x, cam_z, near_radius_m, far_radius_m, loaded, out, KEEP_SPLIT_FACTOR)
    }
  }

  out.sort((a, b) => a.dist2 - b.dist2 || a.level - b.level || a.sx - b.sx || a.sz - b.sz)
  return out
}

/**
 * Recursive DH node visit. Emits into `out`. See the three-way outcome in the file header.
 * @param {number} level current node level
 * @param {number} sx section grid x at this level
 * @param {number} sz section grid z at this level
 * @param {number} cam_x @param {number} cam_z camera world XZ
 * @param {number} near_radius_m @param {number} far_radius_m
 * @param {LoadedPredicate} loaded
 * @param {Selection[]} out
 * @param {number} [split_factor] the KEEP walk's split proximity (KEEP_SPLIT_FACTOR — carries the dead band)
 * @returns {void}
 */
function visit(level, sx, sz, cam_x, cam_z, near_radius_m, far_radius_m, loaded, out, split_factor = SPLIT_FACTOR) {
  const span = section_span_meters(level)
  const x0 = sx * span
  const z0 = sz * span
  const center_x = x0 + span * 0.5
  const center_z = z0 + span * 0.5
  const dx = center_x - cam_x
  const dz = center_z - cam_z
  const dist2 = dx * dx + dz * dz

  // Max-norm distances to the NEAREST and FARTHEST point of the footprint (radii tests use the same
  // metric as the split rule so culling and subdivision agree).
  const nearest = cheby_dist_to_box(cam_x, cam_z, x0, z0, span)
  const farthest = Math.max(
    Math.abs(cam_x - x0),
    Math.abs(cam_x - (x0 + span)),
    Math.abs(cam_z - z0),
    Math.abs(cam_z - (z0 + span))
  )

  // Cull: entirely past the far horizon (even the nearest point is beyond far_radius).
  if (nearest > far_radius_m) return
  // Inside the NEAR voxel ring (even the farthest point is closer than near_radius): ring_manager owns
  // it — the far shell must not double-render here. Skip the whole subtree.
  if (farthest < near_radius_m) return

  // (1) close enough to want finer detail AND can subdivide.
  if (should_subdivide(level, span, nearest, split_factor)) {
    // DH render-parent-while-children-load: render THIS loaded ancestor as a substitute whenever a DIRECT
    // child can't render anything yet (and this node can). "Can render" is LOCAL and cascades: a child
    // that would subdivide but is itself loaded can substitute for ITS missing grandchildren, so it still
    // counts as renderable — this lands the substitution on the FINEST loaded level per footprint.
    //
    // CRUCIAL: we emit the substitute AND STILL RECURSE, so any ALREADY-BUILT finer descendants are also
    // emitted and render ON TOP of this coarse fill (far_field biases finer sections a hair proud so they
    // win the depth test). Emitting the parent alongside its built children — not instead of them — is
    // what lets refinement land child-by-child: without it, the parent's keep slot would prune every
    // freshly-built child before its 3 siblings arrive (a build↔prune thrash that strands all coverage at
    // the coarsest level — observed). When ALL children can render, `children_ready` is true so the parent
    // is NOT emitted → it drops with no lasting overlap the instant its footprint is fully refined.
    const children_ready = children_all_render(
      level,
      sx,
      sz,
      cam_x,
      cam_z,
      near_radius_m,
      far_radius_m,
      loaded,
      split_factor
    )
    if (!children_ready && loaded(level, sx, sz)) {
      emit(out, level, sx, sz, span, center_x, center_z, dist2, /* substitute */ true)
    }
    const cx0 = sx * 2
    const cz0 = sz * 2
    visit(level - 1, cx0, cz0, cam_x, cam_z, near_radius_m, far_radius_m, loaded, out, split_factor)
    visit(level - 1, cx0 + 1, cz0, cam_x, cam_z, near_radius_m, far_radius_m, loaded, out, split_factor)
    visit(level - 1, cx0, cz0 + 1, cam_x, cam_z, near_radius_m, far_radius_m, loaded, out, split_factor)
    visit(level - 1, cx0 + 1, cz0 + 1, cam_x, cam_z, near_radius_m, far_radius_m, loaded, out, split_factor)
    return
  }

  // (2) coarse enough (or at the finest level) → render THIS section if loaded.
  if (loaded(level, sx, sz)) {
    emit(out, level, sx, sz, span, center_x, center_z, dist2, /* substitute */ false)
    return
  }
  // (3) target level not loaded and we can't go finer to find data → drop (a higher ancestor already
  // emitted a substitute for this footprint, or it is simply not built yet — hole-free by the parent).
}

/**
 * BUILD-ORDER frontier — the sections to DISPATCH next so the far shell fills COARSEST-FIRST and refines
 * inward, given what is already built (`is_loaded` = the REAL built predicate). This is the build-side
 * companion to `select_sections` (the render/keep side). Why it's needed: `select_sections(is_loaded=
 * ()=>true)` returns only the finest DISJOINT leaves, so it never asks to build the coarse ancestors the
 * keep set relies on as render-parent-while-children-load SUBSTITUTES — leaving the near→mid annulus with
 * NO coarse cover while its many fine sections build last (the reported "huge empty band, then only
 * far LOD chunks at the horizon"). The frontier instead:
 *   • builds the COARSEST section over any footprint that has NO built coverage yet (an L4 stand-in lands
 *     first → the keep set substitutes it → the band is covered from ~frame 1, never empty), then
 *   • once coverage exists there, REFINES into the 4 children toward each footprint's target level, and
 *   • emits NOTHING for a footprint already covered down to target — so a substitute the keep set pruned
 *     is NEVER rebuilt (no build↔prune thrash; verified against a leaves-only resident set).
 * Returns UNSORTED Selections (all not-yet-built); the caller sorts coarsest-first for dispatch. Pure.
 * @param {SelectOptions} options `is_loaded` MUST be the real built predicate (an always-true predicate
 *   degenerates to "build every root" — pass the resident set).
 * @returns {Selection[]}
 */
export function select_build_frontier({ camera_xz, near_radius_m, far_radius_m, is_loaded }) {
  const [cam_x, cam_z] = camera_xz
  const loaded = is_loaded ?? (() => true)
  /** @type {Selection[]} */
  const out = []
  const root_span = section_span_meters(LOD_MAX_LEVEL)
  const min_sx = Math.floor((cam_x - far_radius_m) / root_span)
  const max_sx = Math.floor((cam_x + far_radius_m) / root_span)
  const min_sz = Math.floor((cam_z - far_radius_m) / root_span)
  const max_sz = Math.floor((cam_z + far_radius_m) / root_span)
  for (let sz = min_sz; sz <= max_sz; sz += 1) {
    for (let sx = min_sx; sx <= max_sx; sx += 1) {
      frontier_visit(LOD_MAX_LEVEL, sx, sz, cam_x, cam_z, near_radius_m, far_radius_m, loaded, out)
    }
  }
  return out
}

/**
 * Recursive build-frontier visit — mirrors `visit`, but chooses what to BUILD (coarsest uncovered first,
 * then refine) rather than what to render. Emits only not-yet-built sections into `out`.
 * @param {number} level @param {number} sx @param {number} sz @param {number} cam_x @param {number} cam_z
 * @param {number} near_radius_m @param {number} far_radius_m @param {LoadedPredicate} loaded
 * @param {Selection[]} out @returns {void}
 */
function frontier_visit(level, sx, sz, cam_x, cam_z, near_radius_m, far_radius_m, loaded, out) {
  const span = section_span_meters(level)
  const x0 = sx * span
  const z0 = sz * span
  const nearest = cheby_dist_to_box(cam_x, cam_z, x0, z0, span)
  const farthest = Math.max(
    Math.abs(cam_x - x0),
    Math.abs(cam_x - (x0 + span)),
    Math.abs(cam_z - z0),
    Math.abs(cam_z - (z0 + span))
  )
  if (nearest > far_radius_m) return // past the horizon
  if (farthest < near_radius_m) return // owned by the near voxel ring — not a far section

  // (2) coarse enough (or the finest level): the target leaf — build it if it isn't resident.
  if (!should_subdivide(level, span, nearest)) {
    if (!loaded(level, sx, sz)) emit_frontier(out, level, sx, sz, span, cam_x, cam_z)
    return
  }
  // (1) wants finer detail. If this footprint has NO built coverage anywhere yet, build the COARSEST
  //     stand-in NOW (instant gapless cover for the keep set to substitute); otherwise refine into the 4
  //     children. Skipping the coarse build once a descendant covers the area is what stops a pruned
  //     substitute from being rebuilt forever.
  if (!loaded(level, sx, sz) && !subtree_has_built(level, sx, sz, cam_x, cam_z, near_radius_m, far_radius_m, loaded)) {
    emit_frontier(out, level, sx, sz, span, cam_x, cam_z)
    return
  }
  const cx0 = sx * 2
  const cz0 = sz * 2
  frontier_visit(level - 1, cx0, cz0, cam_x, cam_z, near_radius_m, far_radius_m, loaded, out)
  frontier_visit(level - 1, cx0 + 1, cz0, cam_x, cam_z, near_radius_m, far_radius_m, loaded, out)
  frontier_visit(level - 1, cx0, cz0 + 1, cam_x, cam_z, near_radius_m, far_radius_m, loaded, out)
  frontier_visit(level - 1, cx0 + 1, cz0 + 1, cam_x, cam_z, near_radius_m, far_radius_m, loaded, out)
}

/**
 * Whether ANY section in this node's footprint subtree (down to its target leaves, inside the visible
 * annulus) is already built — i.e. the footprint has SOME coverage. Guards the frontier against
 * rebuilding a coarse ancestor once a finer descendant covers the area (the post-prune no-thrash rule).
 * @param {number} level @param {number} sx @param {number} sz @param {number} cam_x @param {number} cam_z
 * @param {number} near_radius_m @param {number} far_radius_m @param {LoadedPredicate} loaded
 * @returns {boolean}
 */
function subtree_has_built(level, sx, sz, cam_x, cam_z, near_radius_m, far_radius_m, loaded) {
  const span = section_span_meters(level)
  const x0 = sx * span
  const z0 = sz * span
  const nearest = cheby_dist_to_box(cam_x, cam_z, x0, z0, span)
  const farthest = Math.max(
    Math.abs(cam_x - x0),
    Math.abs(cam_x - (x0 + span)),
    Math.abs(cam_z - z0),
    Math.abs(cam_z - (z0 + span))
  )
  if (nearest > far_radius_m || farthest < near_radius_m) return false // outside the annulus → no cover needed
  if (loaded(level, sx, sz)) return true
  if (!should_subdivide(level, span, nearest)) return false // an unbuilt leaf
  const cx0 = sx * 2
  const cz0 = sz * 2
  return (
    subtree_has_built(level - 1, cx0, cz0, cam_x, cam_z, near_radius_m, far_radius_m, loaded) ||
    subtree_has_built(level - 1, cx0 + 1, cz0, cam_x, cam_z, near_radius_m, far_radius_m, loaded) ||
    subtree_has_built(level - 1, cx0, cz0 + 1, cam_x, cam_z, near_radius_m, far_radius_m, loaded) ||
    subtree_has_built(level - 1, cx0 + 1, cz0 + 1, cam_x, cam_z, near_radius_m, far_radius_m, loaded)
  )
}

/**
 * Emits one build-frontier Selection (substitute=false — it's a build request, not a render substitute).
 * @param {Selection[]} out @param {number} level @param {number} sx @param {number} sz @param {number} span
 * @param {number} cam_x @param {number} cam_z @returns {void}
 */
function emit_frontier(out, level, sx, sz, span, cam_x, cam_z) {
  const center_x = sx * span + span * 0.5
  const center_z = sz * span + span * 0.5
  const dx = center_x - cam_x
  const dz = center_z - cam_z
  emit(out, level, sx, sz, span, center_x, center_z, dx * dx + dz * dz, false)
}

/**
 * Whether all four DIRECT children of a node can render something (see `can_render`). Children fully
 * outside the near/far radii don't count against readiness (they're never rendered).
 * @param {number} level parent level (checks its children at level-1)
 * @param {number} sx @param {number} sz parent grid pos
 * @param {number} cam_x @param {number} cam_z @param {number} near_radius_m @param {number} far_radius_m
 * @param {LoadedPredicate} loaded
 * @param {number} [split_factor] the walk's split proximity (threaded so readiness matches the render rule)
 * @returns {boolean}
 */
function children_all_render(
  level,
  sx,
  sz,
  cam_x,
  cam_z,
  near_radius_m,
  far_radius_m,
  loaded,
  split_factor = SPLIT_FACTOR
) {
  const cx0 = sx * 2
  const cz0 = sz * 2
  const kids = [
    [cx0, cz0],
    [cx0 + 1, cz0],
    [cx0, cz0 + 1],
    [cx0 + 1, cz0 + 1],
  ]
  for (const [kx, kz] of kids) {
    if (!can_render(level - 1, kx, kz, cam_x, cam_z, near_radius_m, far_radius_m, loaded, split_factor)) return false
  }
  return true
}

/**
 * Whether a node can render SOMETHING for its footprint this frame — LOCAL and self-substituting:
 *   • out of the visible annulus → vacuously true (nothing to draw there),
 *   • wouldn't subdivide (a leaf) → true iff its own section is loaded,
 *   • would subdivide → true iff its four children can render OR the node itself is loaded (so it can
 *     substitute for its not-yet-loaded children). This cascade lands substitution on the FINEST
 *     loaded level per footprint, matching DH's render-parent-while-children-load (not root-coarsening).
 * @param {number} level @param {number} sx @param {number} sz
 * @param {number} cam_x @param {number} cam_z @param {number} near_radius_m @param {number} far_radius_m
 * @param {LoadedPredicate} loaded
 * @param {number} [split_factor] the walk's split proximity (threaded so readiness matches the render rule)
 * @returns {boolean}
 */
function can_render(level, sx, sz, cam_x, cam_z, near_radius_m, far_radius_m, loaded, split_factor = SPLIT_FACTOR) {
  const span = section_span_meters(level)
  const x0 = sx * span
  const z0 = sz * span
  const nearest = cheby_dist_to_box(cam_x, cam_z, x0, z0, span)
  const farthest = Math.max(
    Math.abs(cam_x - x0),
    Math.abs(cam_x - (x0 + span)),
    Math.abs(cam_z - z0),
    Math.abs(cam_z - (z0 + span))
  )
  if (nearest > far_radius_m) return true // out of view → not needed
  if (farthest < near_radius_m) return true // inside the near ring → not a far section
  if (should_subdivide(level, span, nearest, split_factor)) {
    if (children_all_render(level, sx, sz, cam_x, cam_z, near_radius_m, far_radius_m, loaded, split_factor)) return true
    return loaded(level, sx, sz) // self-substitute for not-yet-loaded children
  }
  return loaded(level, sx, sz)
}

/**
 * Pushes one Selection.
 * @param {Selection[]} out @param {number} level @param {number} sx @param {number} sz
 * @param {number} span @param {number} center_x @param {number} center_z @param {number} dist2
 * @param {boolean} substitute
 * @returns {void}
 */
function emit(out, level, sx, sz, span, center_x, center_z, dist2, substitute) {
  out.push({ level, sx, sz, span, center_x, center_z, dist2, substitute })
}

/**
 * Verifies the CRACK-FREE invariant on a selection: no two selected sections whose world footprints
 * are edge-adjacent differ by more than one LOD level. Returns the first offending pair, or null when
 * crack-free. Used by the test battery (and safe as a runtime debug assert). O(n²) — test-scale only.
 *
 * Adjacency is tested in WORLD space (footprints, not grid indices, since indices differ per level):
 * two axis-aligned squares are edge-adjacent when they touch along a shared edge segment of nonzero
 * length (share an X or Z face plane AND overlap on the other axis).
 * @param {Selection[]} selections
 * @returns {{a: Selection, b: Selection, delta: number} | null}
 */
export function assert_crack_free(selections) {
  for (let i = 0; i < selections.length; i += 1) {
    for (let j = i + 1; j < selections.length; j += 1) {
      const a = selections[i]
      const b = selections[j]
      const delta = Math.abs(a.level - b.level)
      if (delta <= 1) continue
      if (footprints_edge_adjacent(a, b)) return { a, b, delta }
    }
  }
  return null
}

/** World-space min corner of a selection's footprint. @param {Selection} s @returns {[number,number]} */
function foot_min(s) {
  return [s.sx * s.span, s.sz * s.span]
}

/**
 * Whether two selection footprints are edge-adjacent (touch along a nonzero-length shared edge).
 * @param {Selection} a @param {Selection} b
 * @returns {boolean}
 */
function footprints_edge_adjacent(a, b) {
  const [ax0, az0] = foot_min(a)
  const ax1 = ax0 + a.span
  const az1 = az0 + a.span
  const [bx0, bz0] = foot_min(b)
  const bx1 = bx0 + b.span
  const bz1 = bz0 + b.span

  // Overlap length on each axis (>0 ⇒ the projections overlap on that axis).
  const overlap_x = Math.min(ax1, bx1) - Math.max(ax0, bx0)
  const overlap_z = Math.min(az1, bz1) - Math.max(az0, bz0)

  // Share a vertical face plane (X edge) AND overlap on Z with nonzero length → edge-adjacent.
  const share_x_face = ax1 === bx0 || bx1 === ax0
  if (share_x_face && overlap_z > 0) return true
  // Share a horizontal face plane (Z edge) AND overlap on X.
  const share_z_face = az1 === bz0 || bz1 === az0
  if (share_z_face && overlap_x > 0) return true
  return false
}
