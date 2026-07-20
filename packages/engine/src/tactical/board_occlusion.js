// D167-B (2026-07-05) — FEATHERED FIGHT-BOARD OCCLUSION (see-through the forest to the arena).
//
// When a tactical board is mounted, world geometry (trees, canopy, terrain bumps) standing BETWEEN the
// camera and the board must melt away so the player can read the arena — but NEVER with a hard clip
// (a feathered camera frustum for visibility). This module is the
// SINGLE HOME for that mask: a pure TSL node fn + the shared uniforms the tactical mount arms/disarms.
// terrain_material hooks the fade in with ONE guarded line per render class; when no board is mounted the
// `active` uniform is 0 and the whole term folds to a no-op (zero cost).
//
// THE MASK (SCREEN-SPACE — the literal "camera frustum for visibility"). The tactical facade projects the
// board's footprint to the screen each frame and stores its screen-space AABB (NDC centre + half-extent)
// plus the board's view-space depth. A fragment is an OCCLUDER when it is BOTH:
//   (1) inside the board's SCREEN rectangle — its own screen position lands within the (skirted) board
//       AABB, with a metres-of-NDC FEATHER rim (soft edge, "never a hard clip"). Screen-space is exact
//       for "does this fragment overlap the arena from the camera's view" — including a tree crowding the
//       board's near corner, which a world-space centroid cone misses.
//   (2) NEARER than the board along the view — its view-space depth is in front of the board's, so we
//       only dissolve things BETWEEN the eye and the arena, never the arena itself or the world behind.
// The two tests multiply into a fade ∈ [0,1] (1 = visible, 0 = dissolved) with a feather on BOTH the
// screen rim and the depth — soft everywhere.
//
// APPLICATION (terrain_material, per class):
//   • solids / cutout (opaque) → SCREEN-DOOR dither: discard the fragment when fade < hash(screen), so
//     the occluder dissolves into a stipple that reads as a soft fade (opaque geo can't alpha-blend).
//   • foliage / liquid (alpha) → multiply fade into out_alpha (they already blend).
// The dither MUST ride the color-output graph (Discard inside the colorNode Fn), never a bare build-scope
// discard — a bare discard is dead code in three's TSL (2026-07-04 far_field post-mortem: the node builder
// compiles only what the output slots reach). We return NODES; the material composes them into its output.

import {
  Discard,
  If,
  float,
  interleavedGradientNoise,
  length,
  max,
  positionView,
  positionWorld,
  screenCoordinate,
  screenSize,
  smoothstep,
  sub,
  uniform,
  vec2,
} from 'three/tsl'
import { Vector2 } from 'three'

// [D267 — the peephole must never be a square; needs to be twice as big and vignette-styled] The
// screen mask is an ELLIPTICAL VIGNETTE, not a rectangle: distance is measured in units of the board's
// screen half-extents (r = 1 at the old AABB edge midpoints, √2 at its corners), fully melted out to
// MELT_CORE_R (past the old rect's corners ⇒ ~2× the melted area) and feathering over a HUGE band to
// MELT_OUTER_R — wide enough to run off the viewport at the fight framing, so no boundary shape is ever
// visible, just a soft radial falloff from melted centre to solid screen corners.
/** Normalized elliptical radius fully melted (1.45 > √2 — the whole old rect incl. corners melts). */
const MELT_CORE_R = 1.45
/** Normalized elliptical radius where the melt reaches zero — the vignette's outer feather. */
const MELT_OUTER_R = 2.6
/** Skirt added to the board's NDC half-extent so the window clears the curbs (a touch wider than tiles). */
// [D251-4/D256 — the see-through region must cover 80%+ of the screen, not a small box] the near cave
// WALL rises ABOVE/around the board's tight screen rect. A GENEROUS skirt widens the dissolve rect so
// it + the board's own screen span cover ~80% of the viewport → the whole near wall (gated by in_front
// + above_floor: far walls + floor stay) dissolves toward the board, not a peephole. With the D256
// closer framing the board's half-extent grows ⇒ rect ≈ 0.45 (board) + 0.4 (skirt) ≈ 0.85 NDC half =
// ~85% viewport width. Tunable; qa's cave-fight drive is the coverage gate.
const FOOTPRINT_SKIRT_NDC = 0.4
/** Depth feather (view-space metres) where the dissolve ramps in near the board — no hard clip. */
const DEPTH_FEATHER_M = 5.0
/** Bias (view-space metres) so fragments AT the board (its curbs/props) are never dissolved. */
const DEPTH_BIAS_M = 1.5

// ── [WORLD FOOTPRINT CLEAR] — the render-side "carve" a world board needs (cave boards are gen-carved; a
// world board seats FLAT on open terrain, so terrain voxels + grass sprites in its footprint poke through
// and above it). A depth-INDEPENDENT world-XZ AABB (the peephole above is depth-gated on `in_front`, so it
// MISSES a voxel poking up mid-footprint, which sits AT/BEHIND the board depth). Armed for WORLD boards only.
/** World-metre soft feather on the AABB rim — a soft dissolve edge, never a hard clip line. */
const FOOTPRINT_FEATHER_M = 1.5
/** Clear terrain/flora ABOVE the board tile line (floor_y + this ≈ FLOOR_THICKNESS): the ground plane and the
 *  terrain the board rests on stay solid — only what pokes ABOVE the flat board surface is cleared. */
const FOOTPRINT_FLOOR_M = 0.37

/**
 * @typedef {object} BoardOcclusionUniforms
 * @property {*} active 1 while a board is mounted, 0 otherwise (guards the whole term → zero cost off).
 * @property {*} screen_center vec2 NDC centre of the board's screen-space footprint AABB.
 * @property {*} screen_half vec2 NDC half-extent of that AABB (+ skirt). Negative components ⇒ off-screen.
 * @property {*} view_dist float POSITIVE view-space distance (−z) from the eye to the board centre.
 * @property {(on: boolean) => void} set_active
 * @property {*} floor_y [D231] board floor world-Y uniform — fragments at/below never dissolve.
 * @property {*} center_xz [D243] board centroid XZ uniform — the world-radius prop cutaway centre.
 * @property {*} radius [D243] board footprint radius uniform (world m; <0 disables the cutaway).
 * @property {*} clear_active [WORLD FOOTPRINT CLEAR] 1 for a world board, 0 for cave boards (folds the term off).
 * @property {*} clear_center vec2 world-XZ centre of the board's footprint AABB (bbox centre, not the mask centroid).
 * @property {*} clear_half vec2 world-XZ half-extents of that AABB, +1 cell margin already applied.
 * @property {(center_ndc: [number, number], half_ndc: [number, number], view_dist: number, board_floor_y?: number, board_center_xz?: [number, number] | null, board_radius?: number) => void} set_screen
 * @property {(center_xz: [number, number], half_xz: [number, number], on: boolean) => void} set_footprint_clear
 */

/**
 * Creates the shared occlusion uniforms. ONE instance is created by the engine and threaded into every
 * terrain-material build; the tactical facade updates set_screen() each frame and set_active() at
 * mount/unmount. Defaults are inert (active 0).
 * @returns {BoardOcclusionUniforms}
 */
export function create_board_occlusion() {
  const active = uniform(0)
  const screen_center = uniform(new Vector2(0, 0))
  const screen_half = uniform(new Vector2(-1, -1)) // off-screen until set
  const view_dist = uniform(1)
  /** [D231] the board's floor world-Y: fragments AT/BELOW it never dissolve — occluders are things
   *  STANDING between camera and board (walls, pillars, canopy), never the ground plane itself (the
   *  grazing sightline to the near cells was dissolving the cave floor into a bright dither band). */
  const floor_y = uniform(-1e9)
  /** [D243] board centroid XZ + footprint radius (world m): the ANGLE-INDEPENDENT prop cutaway. The
   *  screen-AABB feather misses TALL décor (mushrooms/pillars) standing at grazing orbit angles — this
   *  world-space term dissolves any terrain fragment above the floor, in front of the board, WITHIN the
   *  board's footprint radius, from EVERY angle (zero covered cells, by construction). Entities/board tiles
   *  are separate meshes (not terrain material) so they're never touched. */
  const center_xz = uniform(new Vector2(0, 0))
  const radius = uniform(-1) // <0 = off
  /** [WORLD FOOTPRINT CLEAR] the world board's XZ AABB (bbox centre + half-extents incl. margin) + arm flag.
   *  A world board seats FLAT on open terrain (no gen-carve like a cave), so terrain voxels + grass sprites in
   *  its footprint poke through/above it — this AABB clears them render-side, depth-independent, above the board
   *  tile line, reversibly (unmount → clear_active 0). Armed ONLY for world boards; cave boards leave it 0 so
   *  their carved ceiling/walls are never cleared. */
  const clear_active = uniform(0)
  const clear_center = uniform(new Vector2(0, 0))
  const clear_half = uniform(new Vector2(-1, -1)) // off-footprint until armed
  return {
    active,
    screen_center,
    screen_half,
    view_dist,
    floor_y,
    center_xz,
    radius,
    clear_active,
    clear_center,
    clear_half,
    set_active(on) {
      active.value = on ? 1 : 0
      // A full disarm also drops the world footprint clear so unmount restores the world EXACTLY (a rebuild
      // re-arms it for a world board; a cave board never re-arms it — the two failure modes stay dead together).
      if (!on) clear_active.value = 0
    },
    /** Arm/disarm the world-board footprint clear. `center_xz`/`half_xz` are world-XZ metres (half already
     *  includes the +1 cell margin). Called at mount for a WORLD board only; cave boards never call it. */
    set_footprint_clear(center_xz_arg, half_xz, on) {
      clear_active.value = on ? 1 : 0
      if (on && center_xz_arg && half_xz) {
        clear_center.value.set(center_xz_arg[0], center_xz_arg[1])
        clear_half.value.set(half_xz[0], half_xz[1])
      }
    },
    set_screen(center_ndc, half_ndc, dist, board_floor_y = -1e9, board_center_xz = null, board_radius = -1) {
      floor_y.value = board_floor_y
      if (board_center_xz) center_xz.value.set(board_center_xz[0], board_center_xz[1])
      radius.value = board_radius
      screen_center.value.set(center_ndc[0], center_ndc[1])
      screen_half.value.set(half_ndc[0] + FOOTPRINT_SKIRT_NDC, half_ndc[1] + FOOTPRINT_SKIRT_NDC)
      view_dist.value = dist
    },
  }
}

/**
 * The FADE node: 1 = fully visible, 0 = fully dissolved. Pure over the fragment's screen position +
 * view-space depth + the shared uniforms. Extracted so it can be unit-tested via occlusion_fade_value
 * (the JS mirror the test pins the ramp against).
 * @param {BoardOcclusionUniforms} u
 * @returns {*} float node ∈ [0,1]
 */
export function occlusion_fade_node(u) {
  // fragment NDC ∈ [-1,1] from its pixel position (screenCoordinate is pixels; screenSize normalises).
  const frag_ndc = screenCoordinate.div(screenSize).mul(float(2)).sub(float(1))
  // [D267] ELLIPTICAL VIGNETTE distance in units of the board's screen half-extents (1 = the old AABB
  // edge). Fully melted to MELT_CORE_R, feathering radially to solid at MELT_OUTER_R — no square, no
  // visible boundary, just a soft screen-wide falloff.
  const nx = frag_ndc.x.sub(u.screen_center.x).div(u.screen_half.x)
  const ny = frag_ndc.y.sub(u.screen_center.y).div(u.screen_half.y)
  const inside_factor = float(1).sub(smoothstep(float(MELT_CORE_R), float(MELT_OUTER_R), length(vec2(nx, ny))))
  // [D231] ground-plane immunity: only fragments ABOVE the board floor (+0.1..0.5 m feather) may
  // dissolve — the terrain under the sightline stays solid (no bright dither band at the near edge).
  const above_floor = smoothstep(u.floor_y.add(float(0.1)), u.floor_y.add(float(0.5)), positionWorld.y)
  // [D243] ANGLE-INDEPENDENT prop cutaway: 1 inside the board's XZ footprint radius, feathered to 0
  // just outside — so a mushroom/pillar standing over the board melts from any orbit angle (the
  // screen-AABB alone misses tall grazing-angle décor). Disabled (0) when radius < 0.
  const frag_xz_d = length(vec2(positionWorld.x, positionWorld.z).sub(u.center_xz))
  const within_radius = u.radius
    .lessThan(float(0))
    .select(float(0), float(1).sub(smoothstep(u.radius, u.radius.add(float(1.5)), frag_xz_d)))

  // depth: positionView.z is NEGATIVE (−z forward); its magnitude is the view distance. A fragment is IN
  // FRONT of the board when its distance < the board's (by > DEPTH_BIAS), ramped over DEPTH_FEATHER_M so
  // a fragment right at the board depth stays visible (arena + world behind never dissolve).
  const frag_dist = positionView.z.negate()
  const ahead = u.view_dist.sub(frag_dist).sub(float(DEPTH_BIAS_M)) // >0 when the fragment is nearer
  const in_front = smoothstep(float(0), float(DEPTH_FEATHER_M), ahead)

  // THE PEEPHOLE (existing): dissolve occluders BETWEEN eye and board — screen rect (distant trees) OR world
  // radius (near props), depth-gated so only things nearer than the board melt (arena + world behind stay).
  const between = max(inside_factor, within_radius).mul(in_front).mul(above_floor)

  // [WORLD FOOTPRINT CLEAR] depth-INDEPENDENT AABB clear of terrain + flora poking through/above a WORLD board
  // (open terrain, no gen-carve). A fragment inside the board's world-XZ AABB (+margin, soft FEATHER rim) AND
  // above the board tile line clears from EVERY depth/angle — the peephole's `in_front` gate misses fragments
  // sitting AT/BEHIND the board depth, which is exactly where a voxel poking up mid-footprint lives. clear_active
  // is 0 for cave boards (carved rooms) so their ceiling/walls are never touched — the whole term folds to 0.
  const cdx = positionWorld.x.sub(u.clear_center.x).abs()
  const cdz = positionWorld.z.sub(u.clear_center.y).abs()
  const fx = float(1).sub(smoothstep(u.clear_half.x.sub(float(FOOTPRINT_FEATHER_M)), u.clear_half.x, cdx))
  const fz = float(1).sub(smoothstep(u.clear_half.y.sub(float(FOOTPRINT_FEATHER_M)), u.clear_half.y, cdz))
  const above_tile = smoothstep(u.floor_y, u.floor_y.add(float(FOOTPRINT_FLOOR_M)), positionWorld.y)
  const footprint_clear = fx.min(fz).mul(above_tile).mul(u.clear_active)

  const strength = max(between, footprint_clear).mul(u.active)
  return sub(float(1), strength)
}

/**
 * Emits the SCREEN-DOOR dither discard for an OPAQUE class (solid/cutout) DIRECTLY into the CURRENT node
 * stack — call it as a STATEMENT inside the material's `colorNode = Fn(() => { emit(); return … })()`.
 * It must NOT be wrapped in its own Fn: a nested Fn's If/Discard doesn't land in the outer graph (the
 * statements need the outer Fn's active stack — the far_field.js pattern puts If/Discard directly in the
 * colorNode body). Bare build-scope discards are dead code (2026-07-04 far_field post-mortem).
 * @param {BoardOcclusionUniforms} u
 * @returns {void}
 */
export function occlusion_dither_discard(u) {
  const fade = occlusion_fade_node(u)
  // Stable per-pixel threshold in [0,1] (Jimenez interleaved-gradient noise over the SCREEN pixel — the
  // standard screen-door hash; screen-space so the stipple stays on the display, not swimming on the tree
  // as the camera orbits). Discard where fade < threshold: as fade → 0 more pixels drop → a soft stipple
  // dissolve that reads as a feathered fade on opaque geometry (which can't alpha-blend).
  const threshold = interleavedGradientNoise(screenCoordinate)
  If(fade.lessThan(threshold), () => {
    Discard()
  })
}

/**
 * PROJECT the board footprint to a screen-space AABB + view depth (the per-frame CPU work the tactical
 * facade feeds into set_screen). Pure over the camera + the board's world centre/half-extents/floor Y.
 * Returns null when the board is fully behind the camera (nothing to occlude). Reuses the caller's
 * scratch objects to stay allocation-free per frame.
 * @param {import('three').Camera} camera the live engine camera (world matrix + projection)
 * @param {[number, number, number]} center world-space board centroid (+ floor Y)
 * @param {number} half_x world XZ half-extent (east)
 * @param {number} half_z world XZ half-extent (north)
 * @param {number} floor_y world Y of the board floor (the corners sit on it)
 * @param {import('three').Vector3} v3 scratch Vector3
 * @param {import('three').Matrix4} view_proj scratch Matrix4 (set to camera view-projection by the caller)
 * @returns {{ center_ndc: [number, number], half_ndc: [number, number], view_dist: number } | null}
 */
export function project_board_screen(camera, center, half_x, half_z, floor_y, v3, view_proj) {
  // the 4 footprint corners + the centre, on the floor plane.
  const cxs = [center[0] - half_x, center[0] + half_x]
  const czs = [center[2] - half_z, center[2] + half_z]
  let min_x = Infinity
  let min_y = Infinity
  let max_x = -Infinity
  let max_y = -Infinity
  let any_in_front = false
  for (const wx of cxs) {
    for (const wz of czs) {
      v3.set(wx, floor_y, wz).applyMatrix4(view_proj) // clip space (applyMatrix4 does the /w internally)
      // three's applyMatrix4 on a Vector3 divides by w, giving NDC ∈ [-1,1] for on-screen points.
      min_x = Math.min(min_x, v3.x)
      max_x = Math.max(max_x, v3.x)
      min_y = Math.min(min_y, v3.y)
      max_y = Math.max(max_y, v3.y)
    }
  }
  // view-space distance to the board centre (−z forward → positive distance).
  v3.set(center[0], center[1], center[2]).applyMatrix4(camera.matrixWorldInverse)
  const view_dist = -v3.z
  any_in_front = view_dist > 0
  if (!any_in_front) return null
  return {
    center_ndc: [(min_x + max_x) / 2, (min_y + max_y) / 2],
    half_ndc: [(max_x - min_x) / 2, (max_y - min_y) / 2],
    view_dist,
  }
}

/**
 * PURE HOST MIRROR of the fade ramp (no TSL) — the unit test pins the shader's screen-space math against
 * this so the two can't drift (same pattern as terrain_tint's straw_tip_ratio). Returns 1 (visible) … 0
 * (dissolved). Inputs are already in the shader's coordinate frame (NDC + view distance).
 * @param {object} args
 * @param {[number, number]} args.frag_ndc fragment NDC ∈ [-1,1]
 * @param {number} args.frag_dist fragment view-space distance (positive)
 * @param {[number, number]} args.center_ndc board screen-AABB centre (NDC)
 * @param {[number, number]} args.half_ndc board screen-AABB half-extent (NDC, skirt already applied)
 * @param {number} args.view_dist board centre view distance (positive)
 * @param {boolean} [args.active]
 * @param {[number, number, number]} [args.frag_world] fragment WORLD position (x,y,z) — the footprint-clear input
 * @param {number} [args.floor_y] board floor world-Y (the footprint-clear vertical gate anchor)
 * @param {[number, number]} [args.clear_center] world-XZ centre of the footprint AABB
 * @param {[number, number]} [args.clear_half] world-XZ half-extents (+ margin) of the footprint AABB
 * @param {boolean} [args.clear_active] world board ⇒ true; cave board ⇒ false (inert)
 * @returns {number}
 */
export function occlusion_fade_value({
  frag_ndc,
  frag_dist,
  center_ndc,
  half_ndc,
  view_dist,
  active = true,
  frag_world,
  floor_y = -1e9,
  clear_center,
  clear_half,
  clear_active = false,
}) {
  if (!active) return 1
  // [D267] elliptical vignette — mirror of the node's normalized radial falloff (the PEEPHOLE, depth-gated).
  const nx = (frag_ndc[0] - center_ndc[0]) / half_ndc[0]
  const ny = (frag_ndc[1] - center_ndc[1]) / half_ndc[1]
  const inside_factor = 1 - smoothstep_h(MELT_CORE_R, MELT_OUTER_R, Math.hypot(nx, ny))
  const ahead = view_dist - frag_dist - DEPTH_BIAS_M
  const in_front = smoothstep_h(0, DEPTH_FEATHER_M, ahead)
  const between = inside_factor * in_front
  // [WORLD FOOTPRINT CLEAR] depth-INDEPENDENT AABB clear — mirror of the node's world-space term. Inert unless
  // armed (cave boards) or no world position is supplied (the screen-only test cases).
  let footprint_clear = 0
  if (clear_active && frag_world && clear_center && clear_half) {
    const cdx = Math.abs(frag_world[0] - clear_center[0])
    const cdz = Math.abs(frag_world[2] - clear_center[1])
    const fx = 1 - smoothstep_h(clear_half[0] - FOOTPRINT_FEATHER_M, clear_half[0], cdx)
    const fz = 1 - smoothstep_h(clear_half[1] - FOOTPRINT_FEATHER_M, clear_half[1], cdz)
    const above_tile = smoothstep_h(floor_y, floor_y + FOOTPRINT_FLOOR_M, frag_world[1])
    footprint_clear = Math.min(fx, fz) * above_tile
  }
  return 1 - Math.max(between, footprint_clear)
}

/** GLSL smoothstep on the host (edge0 may exceed edge1 — matches TSL's descending-edge usage).
 *  @param {number} edge0 @param {number} edge1 @param {number} x @returns {number} */
function smoothstep_h(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}
