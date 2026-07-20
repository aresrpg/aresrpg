// Cube-World minimap CORE (no React) — a genuine OBLIQUE 2.5-D EXTRUDED relief, not a flat top-down blob.
// Each world column is drawn as a raised tile: a hill-shaded TOP face lifted up-screen by its height, over a
// darker SIDE wall — and the columns are painted BACK-TO-FRONT so near/taller terrain OCCLUDES what's behind
// it. The grid rotates with the camera (heading stays up), so the extruded relief spins under a fixed player
// arrow — the Cube-World map convention (picroma reference). ROUND-4 contract: the slab is a FULLY-INSET
// floating island (the hook derives the zoom so the rotated slab + its cliff walls never reach the frame —
// lift_px bounds the vertical excursion here) drawn in a FIXED bright-day palette (day_remap — the reference
// screenshot's sunlight is part of the ordered match; the world's own mood/atmosphere never dims the map).
// Two costs, split per the brief:
//   • sample_relief_grid — LAZY (on a chunk-cross): the engine's analytic per-column {height, colour}
//     (world_minimap_column) into a north-up grid + a precomputed hill-shade + prominence (both yaw-invariant).
//   • render_oblique — the per-frame projection: rotate each cell by the camera yaw, oblique-project with a
//     height lift, depth-sort, draw tile+wall. Arithmetic + fillRects only (no engine calls) — allocation-free
//     (reused depth/index scratch on the grid). Idle frames are skipped by the caller (see use_minimap.js).
//
// ROUND-5 (live, verbatim riders): the SMALL map's motion must ease (angle_lerp — a shortest-path,
// wrap-safe exponential smoothing step use_minimap.js lerps the heading through every frame, so a fast
// look-around glides instead of snapping) and pin snugly to its corner (render_oblique's cx/cy anchor —
// biased off dead-centre so the visible island hugs the top-right corner instead of floating toward the
// middle of its own bounding box). The EXPANDED map is a SEPARATE, deliberately dumber read: render_flat_*
// — ZERO 3-D (no lift/wall/depth-sort — flat tiles never occlude, so it's cheaper than render_oblique, not
// merely flatter), NORTH-UP FIXED (unlike the small map, the terrain never rotates — theta stays 0; only the
// player ARROW rotates, showing facing, the "real map" convention), region-SCALE (hundreds of blocks, coarse
// blocks/texel — a map consult, not a live render, so MinimapModal.jsx paints it ONCE on open, progressively
// coarse-then-fine, and never re-samples/redraws the terrain per frame — only the marker/arrow overlay
// redraws on pose/hover change, on its OWN canvas layer so that stays cheap regardless of terrain size).

/** Oblique ground-plane squash (screen-fixed tilt) — lower = more tilted/3-D, higher = more top-down. Tuned
 *  to the Cube-World reference (a strongly tilted slab). */
export const MAP_TILT = 0.48
/** Heading-up rotation binding to camera yaw. DERIVED (not guessed) from the proven compass convention
 *  (compass_math.js): the rig's forward is (-sin yaw, -cos yaw), so rotating a map element by θ = yaw makes
 *  camera-forward project to straight UP. ONE home — the small map's terrain rotation (use_minimap.js) AND
 *  the expanded map's player-arrow rotation (MinimapModal.jsx) both read these, so a future rig-convention
 *  change never needs a second edit. */
export const MAP_YAW_SIGN = 1
export const MAP_YAW_OFFSET = 0
/** EXTRUSION ratio — screen px of lift per block of height, PER pixel-per-block of zoom (the hook multiplies
 *  by its derived ppb). Tying lift to the zoom keeps the relief pop proportional at any inset/frame size —
 *  round 4 replaced the fixed px-per-block MAP_HEIGHT_SCALE, which would have doubled the apparent
 *  exaggeration once the island-inset zoom-out landed. ≈ round 3's accepted small-map ratio. */
export const MAP_RELIEF = 0.55
/** Side-wall darkening vs the lit top face (the block's shaded side — the depth cue). */
const SIDE_SHADE = 0.62
/** Wall never shorter/taller than these (px) so every tile reads as a block, cliffs stay bounded. */
const MIN_WALL = 1.5
const MAX_WALL = 34
/** Forced minimum wall depth (BLOCKS, pre height_scale) at the sample-grid's outer ring — round-3 fix
 *  ("it's not a circle, it's a 3D shape"): the grid boundary now reads as a deliberate cliff/pedestal
 *  (the floating-island edge) regardless of the real local terrain gradient there, baked into `prominence`
 *  (yaw-invariant) so render_oblique stays a cheap per-cell lookup. 14 blocks keeps the pedestal chunky at
 *  round 4's zoom-tied MAP_RELIEF (6 read fine only at the old fixed px-per-block lift). */
const EDGE_WALL_BLOCKS = 14
/** Extra-dark wall shade for that boundary ring vs an ordinary interior terrain step (SIDE_SHADE) — sells
 *  the "base/underside" read the Cube-World reference has at its slab edge. */
const EDGE_SIDE_SHADE = 0.4
/** Max height lift as a fraction of the viewport side — bounds the island's vertical excursion so extreme
 *  relief can never push the slab (or a marker riding it) past the frame the round-4 inset guarantees.
 *  Normal windows never touch it (typical mountain spread ≈ ±25 blocks ⇒ ~15 px at the small map's zoom). */
const LIFT_CLAMP_FRAC = 0.1
/** FIXED-DAY map palette (round 4, DIALED BACK round 5 to fix colors that read too
 *  flashy) — the picroma reference is bright daylight and that brightness IS part of the ordered match, but
 *  r4's land grade (sat 1.6, gamma 0.52, tint spread 0.31) overshot into candy territory. Land keeps a
 *  MILDER saturation push + softer gamma mid-lift + a much narrower warm tint (sat 1.6→1.2, gamma 0.52→0.68
 *  i.e. less lift, tint spread 0.31→0.13) — still clearly daylight, but it now sits quietly in the HUD.
 *  Water (blue-dominant, untouched — not part of the round-5 fix) keeps its original mild deep-blue
 *  grade, kept dark on purpose so the island's land stays the (now calmer) bright subject. MAP-ONLY —
 *  nothing in the world rendering reads these. */
const DAY_LAND_SAT = 1.2
const DAY_LAND_GAMMA = 0.68
const DAY_LAND_TINT = [1.0, 1.03, 0.9]
const DAY_WATER_SAT = 1.25
const DAY_WATER_GAMMA = 0.78
const DAY_WATER_TINT = [0.9, 1.0, 1.18]
/** Hill-shade light dir (map-XZ, top-left) + strengths — bakes the relief read into the top face colour. */
const LIGHT_X = -0.6
const LIGHT_Z = -0.8
const SLOPE_STRENGTH = 1.15
const HEIGHT_STRENGTH = 0.24
const SHADE_FLOOR = 0.66
const SHADE_CEIL = 1.42

/**
 * @typedef {object} ReliefGrid a north-up sampled column grid + the yaw-invariant relief precompute.
 * @property {number} n texels/side @property {number} span blocks covered @property {number} center_x
 * @property {number} center_z @property {Float32Array} heights per-cell surface-y @property {Uint8Array} shaded
 * per-cell top-face colour (rgb, hill-shaded) @property {Float32Array} prominence per-cell height above its
 * lowest neighbour (the wall height, in blocks) @property {number} ref_h lift reference (grid mean-ish)
 * @property {Int32Array} order reused depth-sort index scratch @property {Float32Array} depth reused depth scratch
 */

/**
 * Fixed-day palette remap for ONE sampled map colour (0-255 channels in and out) — PURE. Splits land vs
 * water on blue dominance (the engine's water map colour is the only blue-dominant surface family; snowy
 * neutrals landing on the water branch just grade icy-blue, which reads right). Per channel: saturate around
 * luma, gamma-lift the mids into sunlight, then tint. See the DAY_* constants for the why.
 * @param {number} r @param {number} g @param {number} b
 * @returns {[number, number, number]} the day-graded channels
 */
export function day_remap(r, g, b) {
  const water = b >= r && b >= g
  const sat = water ? DAY_WATER_SAT : DAY_LAND_SAT
  const gamma = water ? DAY_WATER_GAMMA : DAY_LAND_GAMMA
  const tint = water ? DAY_WATER_TINT : DAY_LAND_TINT
  const luma = 0.299 * r + 0.587 * g + 0.114 * b
  const grade = (c, t) => {
    const s = Math.max(0, luma + (c - luma) * sat)
    return Math.max(0, Math.min(255, 255 * Math.pow(s / 255, gamma) * t))
  }
  return [grade(r, tint[0]), grade(g, tint[1]), grade(b, tint[2])]
}

/**
 * Clamped screen lift (px) for a surface height — THE one home for the height→lift mapping. render_oblique
 * (tiles AND markers) and the hook's hit-tester must all agree or map clicks drift off their markers; the
 * clamp (±size·LIFT_CLAMP_FRAC) is what lets the hook GUARANTEE the island stays inside the frame.
 * @param {number} h surface height (blocks) @param {number} ref_h grid lift reference
 * @param {number} height_scale px per block @param {number} size viewport side (px)
 * @returns {number} lift in px
 */
export function lift_px(h, ref_h, height_scale, size) {
  const cap = size * LIFT_CLAMP_FRAC
  const lift = (h - ref_h) * height_scale
  return lift > cap ? cap : lift < -cap ? -cap : lift
}

/**
 * ONE eased step of a heading (rad) toward a live target — exponential smoothing (frame-rate independent via
 * `dt_ms`), shortest-path around the ±π wrap seam (a target that crosses from +π to -π eases through the
 * SHORT way, never spins the long way round). THE one home for "very smooth" map rotation (round 5
 * requirement: the map's movement must read very smooth) — use_minimap.js calls this every rAF tick instead of snapping
 * straight to the live camera yaw. PURE (unit-tested).
 * @param {number} current current eased heading (rad, any range) @param {number} target live target heading (rad, any range)
 * @param {number} dt_ms elapsed ms since the last step @param {number} tau_ms smoothing time constant (ms) — larger = lazier follow
 * @returns {number} the new eased heading
 */
export function angle_lerp(current, target, dt_ms, tau_ms) {
  let delta = (target - current) % (Math.PI * 2)
  if (delta > Math.PI) delta -= Math.PI * 2
  else if (delta < -Math.PI) delta += Math.PI * 2
  const k = 1 - Math.exp(-dt_ms / tau_ms)
  return current + delta * k
}

/**
 * Samples a north-up `n`×`n` relief grid of the world around (center_x, center_z) over `span` blocks, and
 * precomputes the two yaw-invariant relief inputs: a hill-shaded top-face colour (slope toward a fixed light +
 * absolute-height lightening) and each cell's prominence (height above its lowest 4-neighbour → the wall
 * height). PURE: `probe(wx,wz)` = the engine's world_minimap_column (or a fake in tests). Reuses `prev`'s
 * typed arrays when the size matches (zero per-resample allocation once warm).
 * @param {number} center_x @param {number} center_z @param {number} span @param {number} n
 * @param {(wx:number,wz:number)=>{surface_y:number,color:[number,number,number]}} probe
 * @param {ReliefGrid} [prev] a same-`n` grid to reuse the buffers of
 * @returns {ReliefGrid}
 */
export function sample_relief_grid(center_x, center_z, span, n, probe, prev) {
  const reuse = prev && prev.n === n
  const heights = reuse ? prev.heights : new Float32Array(n * n)
  const shaded = reuse ? prev.shaded : new Uint8Array(n * n * 3)
  const prominence = reuse ? prev.prominence : new Float32Array(n * n)
  const order = reuse ? prev.order : new Int32Array(n * n)
  const depth = reuse ? prev.depth : new Float32Array(n * n)
  const rc = new Uint8Array(n * n)
  const gc = new Uint8Array(n * n)
  const bc = new Uint8Array(n * n)
  const step = span / n
  const half = span / 2
  let min_h = Infinity
  let max_h = -Infinity
  let sum_h = 0
  for (let z = 0; z < n; z++) {
    const wz = center_z - half + (z + 0.5) * step
    for (let x = 0; x < n; x++) {
      const wx = center_x - half + (x + 0.5) * step
      const i = z * n + x
      const c = probe(wx, wz)
      heights[i] = c.surface_y
      // fixed-day grade at sample time (never mutates the probe's shared colour triple)
      const dc = day_remap(c.color[0], c.color[1], c.color[2])
      rc[i] = dc[0]
      gc[i] = dc[1]
      bc[i] = dc[2]
      sum_h += c.surface_y
      if (c.surface_y < min_h) min_h = c.surface_y
      if (c.surface_y > max_h) max_h = c.surface_y
    }
  }
  const range = max_h - min_h
  const ref_h = sum_h / (n * n)
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const i = z * n + x
      const hx0 = heights[z * n + Math.max(0, x - 1)]
      const hx1 = heights[z * n + Math.min(n - 1, x + 1)]
      const hz0 = heights[Math.max(0, z - 1) * n + x]
      const hz1 = heights[Math.min(n - 1, z + 1) * n + x]
      // prominence: height above the lowest cardinal neighbour → the wall the front edge shows
      const lo = Math.min(hx0, hx1, hz0, hz1)
      prominence[i] = Math.max(0, heights[i] - lo)
      // sample-grid boundary ring → force the floating-island cliff (EDGE_WALL_BLOCKS floor) so the slab's
      // own edge always reads as a deliberate drop, never a gradient-dependent fade-out.
      if (x === 0 || x === n - 1 || z === 0 || z === n - 1) prominence[i] = Math.max(prominence[i], EDGE_WALL_BLOCKS)
      // hill-shade the top face (relief read even on gentle slopes)
      const gx = (hx1 - hx0) * 0.5
      const gz = (hz1 - hz0) * 0.5
      const slope = -(gx * LIGHT_X + gz * LIGHT_Z)
      const hn = range > 0.5 ? (heights[i] - min_h) / range : 0.5
      let shade = 1 + slope * (SLOPE_STRENGTH / step) + (hn - 0.5) * 2 * HEIGHT_STRENGTH
      if (shade < SHADE_FLOOR) shade = SHADE_FLOOR
      else if (shade > SHADE_CEIL) shade = SHADE_CEIL
      const o = i * 3
      shaded[o] = Math.min(255, rc[i] * shade)
      shaded[o + 1] = Math.min(255, gc[i] * shade)
      shaded[o + 2] = Math.min(255, bc[i] * shade)
    }
  }
  return { n, span, center_x, center_z, heights, shaded, prominence, ref_h, order, depth }
}

/**
 * Ground-plane projection of a world offset (dx,dz) from the player: heading-up rotation by `theta` then the
 * oblique vertical squash `tilt` (NO height lift — used for markers/north/hit-test). PURE (unit-tested).
 * @param {number} dx @param {number} dz @param {number} theta @param {number} tilt
 * @returns {{ x:number, z:number }} map-space offset (blocks; × pixels-per-block for screen px)
 */
export function project_offset(dx, dz, theta, tilt) {
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  return { x: dx * cos - dz * sin, z: (dx * sin + dz * cos) * tilt }
}

/**
 * Paints ONE oblique 2.5-D relief frame into `ctx` (square viewport `size`). NO outer mask — the terrain's own
 * silhouette (hill skyline + the forced boundary cliff) is the widget edge, a free-floating isometric slab, not
 * a circular lens (round-3 fix). Rotates the grid to the live heading, projects every column to a lifted tile +
 * side wall, paints them back-to-front (near occludes far), then the entity markers, the player arrow, and the
 * orbiting north tick — anchored at (cx,cy), which the small-map hook biases OFF dead-centre (round 5 fix:
 * the island wasn't properly top right) so the visible island hugs the widget's corner instead of floating toward the
 * middle of its own (invisible, borderless) bounding box. Allocation-free (the grid's `order`/`depth` scratch
 * is reused).
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReliefGrid} grid
 * @param {object} o
 * @param {number} o.size viewport side (px) @param {number} o.ppb pixels per block @param {number} o.tilt
 * @param {number} o.height_scale px per block of lift @param {number} o.theta heading rotation (rad)
 * @param {number} o.player_x live player world-x @param {number} o.player_z live player world-z
 * @param {number} [o.cx] anchor x (px, default size/2) @param {number} [o.cy] anchor y (px, default size/2)
 * @param {Array<{x:number,z:number,kind:string,hot?:boolean}>} [o.markers]
 * @param {boolean} [o.arrow] draw the centre arrow (default true)
 * @returns {void}
 */
export function render_oblique(ctx, grid, o) {
  const { size, ppb, tilt, height_scale, theta, player_x, player_z } = o
  const { n, span, center_x, center_z, heights, shaded, prominence, ref_h, order, depth } = grid
  const cx = o.cx ?? size / 2
  const cy = o.cy ?? size / 2
  // the north-tick's orbit radius must clear EVERY edge from the (possibly off-centre) anchor, not just
  // assume a symmetric half-frame — the tightest of the 4 clearances bounds it safely in every direction.
  const r = Math.min(cx, size - cx, cy, size - cy) - 1
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const step = span / n
  const half = span / 2
  const tile_w = step * ppb * 1.25 + 0.6 // overdraw closes the inter-tile seams
  const top_h = Math.max(1, tile_w * tilt)
  // depth key per cell (rotated z; larger = nearer the viewer = drawn later). Recomputed every frame (positions
  // depend on the live player pan), but the ORDER is translation-invariant — a pan shifts every depth by the
  // same constant — so it only needs re-sorting when the YAW changed (cached on the grid): walk-straight frames
  // skip the O(n² log n) sort entirely.
  for (let i = 0; i < n * n; i++) {
    const gx = i % n
    const gz = (i / n) | 0
    const dx = center_x - half + (gx + 0.5) * step - player_x
    const dz = center_z - half + (gz + 0.5) * step - player_z
    depth[i] = dx * sin + dz * cos
  }
  const g = /** @type {ReliefGrid & { _sort_theta?: number }} */ (grid)
  if (g._sort_theta === undefined || Math.abs(theta - g._sort_theta) > 1e-4) {
    for (let i = 0; i < n * n; i++) order[i] = i
    order.sort((a, b) => depth[a] - depth[b])
    g._sort_theta = theta
  }

  ctx.clearRect(0, 0, size, size) // no backing fill — unpainted px stay transparent (the "free-floating slab" read)

  for (let k = 0; k < n * n; k++) {
    const i = order[k]
    const gx = i % n
    const gz = (i / n) | 0
    const dx = center_x - half + (gx + 0.5) * step - player_x
    const dz = center_z - half + (gz + 0.5) * step - player_z
    const rx = dx * cos - dz * sin
    const gy = cy + depth[i] * ppb * tilt
    const sx = cx + rx * ppb
    const lift = lift_px(heights[i], ref_h, height_scale, size)
    const top_y = gy - lift
    const o3 = i * 3
    let wall = prominence[i] * height_scale
    if (wall < MIN_WALL) wall = MIN_WALL
    else if (wall > MAX_WALL) wall = MAX_WALL
    // side wall (darker), hanging below the top face's front edge — the sample-grid's own outer ring gets the
    // extra-dark EDGE shade so its forced EDGE_WALL_BLOCKS cliff reads as the slab's base, not a terrain step
    const on_edge = gx === 0 || gx === n - 1 || gz === 0 || gz === n - 1
    const wall_shade = on_edge ? EDGE_SIDE_SHADE : SIDE_SHADE
    ctx.fillStyle = `rgb(${(shaded[o3] * wall_shade) | 0},${(shaded[o3 + 1] * wall_shade) | 0},${(shaded[o3 + 2] * wall_shade) | 0})`
    ctx.fillRect(sx - tile_w / 2, top_y, tile_w, top_h / 2 + wall)
    // lit top face
    ctx.fillStyle = `rgb(${shaded[o3]},${shaded[o3 + 1]},${shaded[o3 + 2]})`
    ctx.fillRect(sx - tile_w / 2, top_y - top_h / 2, tile_w, top_h)
  }

  // entity markers — projected onto the tilted plane + lifted to the terrain top under them. Culled to the
  // SAMPLED SLAB's world footprint (round 4): the island floats inside the frame now, so a frame-edge cull
  // would leave markers hovering in the transparent margin off the island.
  if (o.markers) {
    for (const m of o.markers) {
      const gi = grid_index_at(grid, m.x, m.z)
      if (gi < 0) continue
      const dx = m.x - player_x
      const dz = m.z - player_z
      const rx = dx * cos - dz * sin
      const rz = dx * sin + dz * cos
      const sx = cx + rx * ppb
      const gy = cy + rz * ppb * tilt
      const lift = lift_px(heights[gi], ref_h, height_scale, size)
      draw_marker(ctx, sx, gy - lift - 5, m.kind, !!m.hot)
    }
  }

  if (o.arrow !== false) draw_player_arrow(ctx, cx, cy)
  const np = project_offset(0, -1, theta, tilt)
  const nlen = Math.hypot(np.x, np.z) || 1
  draw_north_tick(ctx, cx + (np.x / nlen) * r, cy + (np.z / nlen) * r)
}

/**
 * Paints the TERRAIN ONLY of a FLAT top-down 2-D frame into `ctx` (square viewport `size`) — the EXPANDED
 * map's projection (round 5, switched to 2D — not 3D — viewed from a real distance). NO lift, NO side wall, NO
 * depth-sort: flat tiles never occlude each other (unlike the extruded slab, where a near tall block can
 * cover a far short one), so paint order doesn't matter — cheaper than render_oblique, not merely flatter.
 * The hill-shade already baked into `grid.shaded` at sample time (day_remap + slope shading, see
 * sample_relief_grid) still reads as a subtle relief cue for free. Split from the marker/arrow/north overlay
 * (render_flat_overlay) on purpose: at region scale this terrain pass is the expensive one (tens of
 * thousands of cells — MinimapModal.jsx paints it ONCE on open, never per-frame), while the overlay is cheap
 * and redraws on every pose/hover change on its OWN canvas layer.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReliefGrid} grid
 * @param {object} o
 * @param {number} o.size viewport side (px) @param {number} o.ppb pixels per block
 * @param {number} [o.theta] heading rotation (rad) — 0 (default) for the expanded map's NORTH-UP fixed read
 * @param {number} o.player_x live player world-x @param {number} o.player_z live player world-z
 * @returns {void}
 */
export function render_flat_terrain(ctx, grid, o) {
  const { size, ppb, player_x, player_z } = o
  const theta = o.theta ?? 0
  const { n, span, center_x, center_z, shaded } = grid
  const c = size / 2
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  const step = span / n
  const half = span / 2
  const tile_w = step * ppb * 1.25 + 0.6 // overdraw closes inter-tile seams (same constant as render_oblique)

  ctx.clearRect(0, 0, size, size) // no backing fill — unpainted px stay transparent (floats over the live game)

  for (let gz = 0; gz < n; gz++) {
    const wz = center_z - half + (gz + 0.5) * step
    for (let gx = 0; gx < n; gx++) {
      const wx = center_x - half + (gx + 0.5) * step
      const i = gz * n + gx
      const dx = wx - player_x
      const dz = wz - player_z
      const sx = c + (dx * cos - dz * sin) * ppb
      const sy = c + (dx * sin + dz * cos) * ppb
      const o3 = i * 3
      ctx.fillStyle = `rgb(${shaded[o3]},${shaded[o3 + 1]},${shaded[o3 + 2]})`
      ctx.fillRect(sx - tile_w / 2, sy - tile_w / 2, tile_w, tile_w)
    }
  }
}

/**
 * Paints the OVERLAY (markers + player arrow + north tick) of the flat expanded map — cheap (O(#markers)),
 * meant to redraw on every pose/hover change without touching the (expensive, painted-once) terrain layer
 * underneath it (a separate canvas — see render_flat_terrain). NORTH-UP fixed (`theta` stays 0 by default,
 * same as the terrain, so marker positions agree with it): unlike the small map, the TERRAIN never rotates
 * here, so the player arrow rotates instead (`o.heading`) to show facing — the "real map" convention.
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReliefGrid} grid
 * @param {object} o
 * @param {number} o.size viewport side (px) @param {number} o.ppb pixels per block
 * @param {number} [o.theta] marker projection rotation (rad, default 0 — must match render_flat_terrain's)
 * @param {number} o.player_x live player world-x @param {number} o.player_z live player world-z
 * @param {Array<{x:number,z:number,kind:string,hot?:boolean}>} [o.markers]
 * @param {boolean} [o.arrow] draw the player arrow (default true) @param {number} [o.heading] arrow rotation (rad, default 0)
 * @returns {void}
 */
export function render_flat_overlay(ctx, grid, o) {
  const { size, ppb, player_x, player_z } = o
  const theta = o.theta ?? 0
  const c = size / 2
  const r = c - 1
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)

  ctx.clearRect(0, 0, size, size)

  if (o.markers) {
    for (const m of o.markers) {
      const gi = grid_index_at(grid, m.x, m.z)
      if (gi < 0) continue
      const dx = m.x - player_x
      const dz = m.z - player_z
      const sx = c + (dx * cos - dz * sin) * ppb
      const sy = c + (dx * sin + dz * cos) * ppb
      draw_marker(ctx, sx, sy, m.kind, !!m.hot)
    }
  }

  if (o.arrow !== false) draw_player_arrow(ctx, c, c, o.heading ?? 0)
  const np = project_offset(0, -1, theta, 1)
  const nlen = Math.hypot(np.x, np.z) || 1
  draw_north_tick(ctx, c + (np.x / nlen) * r, c + (np.z / nlen) * r)
}

/** Nearest grid cell index for a world (x,z), or -1 if outside the sampled slab — the marker cull AND the
 *  hook's hit-tester key off it (a marker off the island isn't drawn, so it must not be clickable either).
 *  @returns {number} */
export function grid_index_at(grid, wx, wz) {
  const { n, span, center_x, center_z } = grid
  const step = span / n
  const gx = Math.round((wx - (center_x - span / 2)) / step - 0.5)
  const gz = Math.round((wz - (center_z - span / 2)) / step - 0.5)
  if (gx < 0 || gx >= n || gz < 0 || gz >= n) return -1
  return gz * n + gx
}

/** Sizes a canvas's BACKING STORE for the device pixel ratio while every draw call keeps working in CSS-px
 *  `size` units (round 5: "stays crisp" at the doubled small map AND the region-scale expanded map — neither
 *  render fn needs to know about DPR at all). ONE home — use_minimap.js (small map) and MinimapModal.jsx
 *  (expanded map, both its terrain + overlay canvases) all call this instead of repeating the 4 lines.
 *  @param {HTMLCanvasElement} canvas @param {number} size CSS-px viewport side
 *  @returns {CanvasRenderingContext2D | null} */
export function setup_dpr_canvas(canvas, size) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(size * dpr)
  canvas.height = Math.round(size * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return ctx
}

/** Gold player arrow at (x,y). `heading` (rad, default 0) rotates the arrow in place — unused by the small
 *  map (its terrain rotates under a fixed up-pointing arrow instead) but read by render_flat_overlay's
 *  north-up expanded map, where the arrow itself must rotate to show facing. @returns {void} */
function draw_player_arrow(ctx, x, y, heading = 0) {
  ctx.save()
  ctx.translate(x, y)
  if (heading) ctx.rotate(heading) // north-up maps (render_flat_overlay) rotate the arrow, not the terrain
  ctx.beginPath()
  ctx.moveTo(0, -8)
  ctx.lineTo(5.5, 7)
  ctx.lineTo(0, 3.5)
  ctx.lineTo(-5.5, 7)
  ctx.closePath()
  ctx.fillStyle = '#f5d0a9'
  ctx.strokeStyle = 'rgba(10,10,15,0.9)'
  ctx.lineWidth = 1.3
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

/** North notch on the ring. @returns {void} */
function draw_north_tick(ctx, x, y) {
  ctx.save()
  ctx.fillStyle = '#c8963c'
  ctx.beginPath()
  ctx.arc(x, y, 3.4, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** Entity marker — mob = red diamond, resource = gold dot, peer (other player) = cyan dot (the house
 *  player-dot convention — see presence_markers.js); `hot` adds a halo. @returns {void} */
function draw_marker(ctx, x, y, kind, hot) {
  const mob = kind === 'mob'
  const peer = kind === 'peer'
  const col = mob ? '#ff6b6b' : peer ? '#4a9eff' : '#c8963c'
  if (hot) {
    ctx.beginPath()
    ctx.arc(x, y, 7, 0, Math.PI * 2)
    ctx.fillStyle = mob ? 'rgba(255,107,107,0.28)' : peer ? 'rgba(74,158,255,0.28)' : 'rgba(200,150,60,0.30)'
    ctx.fill()
  }
  ctx.save()
  ctx.translate(x, y)
  if (mob) ctx.rotate(Math.PI / 4)
  ctx.beginPath()
  if (mob) ctx.rect(-3.2, -3.2, 6.4, 6.4)
  else ctx.arc(0, 0, 3.2, 0, Math.PI * 2)
  ctx.fillStyle = col
  ctx.strokeStyle = 'rgba(10,10,15,0.92)'
  ctx.lineWidth = 1.1
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}
