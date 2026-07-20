// The small HUD minimap's VIEW hook (Minimap.jsx) — the oblique 2.5-D relief. ROUND 5: the expanded map
// (MinimapModal.jsx) dropped this hook entirely for its own bespoke, region-scale, paint-once architecture
// (see MinimapModal.jsx's header) — this file is oblique-map-only now. Splits the two costs the Cube-World
// brief mandates:
//   • SAMPLING is LAZY — a React effect keyed on the player's coarse sample-cell (+ world binding) rebuilds the
//     cached north-up relief grid (heights + hill-shade + prominence) only when the player has walked ~a cell.
//   • DRAWING is per-frame BUT skipped when nothing moved — a rAF reads the LIVE pose (yaw for the heading-up
//     rotation, x/z for smooth pan) and re-projects the cached grid each frame the yaw/position actually
//     changed (idle = zero cost; the canvas holds). ROUND-5: the drawn heading is an EASED value (angle_lerp)
//     that glides toward the live yaw every tick instead of snapping to it — "still" now also stays false
//     while that ease is catching up, so the settle tail after a turn still repaints.
// The engine tap `world_minimap_column` is analytic (no chunk residency) so the map paints the real terrain
// even before chunks stream in.

import { useEffect, useRef } from 'react'

import { world_minimap_column } from '@aresrpg/engine3'

import { use_game_state, context } from '../../store.js'
import { use_world_binding } from '../../../world-shell/session_gate.js'
import { instrument_cpu_callback } from '../../cpu_span.js'
import {
  sample_relief_grid,
  render_oblique,
  angle_lerp,
  setup_dpr_canvas,
  MAP_TILT,
  MAP_RELIEF,
  MAP_YAW_SIGN,
  MAP_YAW_OFFSET,
} from './minimap_engine.js'

/** ROUND-4 (v3 still bled off the frame): the island must float FULLY inside the frame — clear transparency
 *  on every side at EVERY heading. The zoom (ppb) is DERIVED from this bound: the slab's worst-case rotated
 *  half-diagonal — (view_radius + the between-resamples pan drift) · √2 blocks — maps to at most CORNER_FILL
 *  · half-frame px in the anchor's TIGHTEST direction (see CORNER_BIAS below). MAP_TILT<1 squashes the
 *  vertical, lift_px clamps the height excursion, walls cap at MAX_WALL (minimap_engine.js) — the vertical
 *  fits a fortiori. */
const CORNER_FILL = 0.8
/** ROUND-5 — the minimap's visible island should sit
 *  naturally in the corner region: the anchor (where the player/terrain-centre projects on screen) is
 *  biased OFF dead-centre toward the top-right by this fraction of the half-frame, so the visible island
 *  hugs the widget's actual corner instead of floating toward the middle of its own (borderless, invisible)
 *  bounding box. CORNER_FILL + CORNER_BIAS ≤ 1 (with a small buffer) is what keeps round-4's "never reaches
 *  the frame" guarantee intact under the new off-centre anchor — the anchor's clearance shrinks by exactly
 *  this fraction toward the top/right edges (and grows by the same amount toward bottom/left, which is fine:
 *  that side just tapers into the game view, no corner expectation there). */
const CORNER_BIAS = 0.16
/** Between-resamples pan drift budget: the grid re-centres only when the player crosses a resample cell, so
 *  the drawn slab drifts off-centre by up to one cell before snapping back — the inset derivation above must
 *  absorb it. 0.15·R keeps it small (≈½ the round-3 cadence; resample ≈6–14 ms, still off the frame loop). */
const RESAMPLE_STEP_RATIO = 0.15
/** Re-project only past these deltas (idle frames are skipped — the canvas retains the last paint). */
const YAW_EPS = 0.004 // rad (~0.23°)
const POS_EPS = 0.15 // blocks
/** ROUND-5 eased heading (smooths the movement) — the DISPLAYED heading
 *  glides toward the live camera yaw via angle_lerp instead of snapping to it every frame. ~90ms time
 *  constant closes ~86% of a step change in two 60fps ticks — brisk enough it never reads as laggy, slow
 *  enough that fast look-around glides instead of stepping. */
const YAW_EASE_TAU_MS = 90

/**
 * Drives the small minimap canvas: lazily samples the relief grid and re-projects it to the oblique 2.5-D
 * relief each frame the camera/player moves, anchored off-centre toward the top-right corner (round 5).
 * @param {import('react').RefObject<HTMLCanvasElement|null>} canvas_ref
 * @param {object} opts
 * @param {number} opts.size canvas viewport side (CSS px) @param {number} opts.view_radius_blocks slab half-extent
 * (blocks) — the sampled island covers ±this around the player
 * @param {number} opts.sample_n grid resolution (texels/side)
 * @param {Array<{x:number,z:number,kind:string,key:string,hot?:boolean}>} opts.markers
 * @param {boolean} [opts.enabled]
 * @returns {void}
 */
export function use_minimap(canvas_ref, { size, view_radius_blocks, sample_n, markers, enabled = true }) {
  const tex_span = 2 * view_radius_blocks
  const RESAMPLE_STEP = Math.max(6, Math.round(view_radius_blocks * RESAMPLE_STEP_RATIO))
  // the corner-fill zoom derivation (see CORNER_FILL) + the zoom-tied relief strength (see MAP_RELIEF)
  const ppb = ((size / 2) * CORNER_FILL) / ((view_radius_blocks + RESAMPLE_STEP) * Math.SQRT2)
  const height_scale = ppb * MAP_RELIEF
  // off-centre anchor (round 5 corner hug) — biased toward the top-right by CORNER_BIAS of the half-frame.
  const cx = size / 2 + CORNER_BIAS * (size / 2)
  const cy = size / 2 - CORNER_BIAS * (size / 2)
  const cell_key = use_game_state((s) => {
    const p = s.player_pose
    return p ? `${Math.round(p.x / RESAMPLE_STEP)}:${Math.round(p.z / RESAMPLE_STEP)}` : null
  })
  const world_id = use_world_binding((s) => s.world)

  const grid_ref = useRef(/** @type {import('./minimap_engine.js').ReliefGrid | null} */ (null))
  const grid_ver_ref = useRef(0)
  const markers_ref = useRef(markers)
  markers_ref.current = markers
  // ROUND-5 eased heading state — persists ACROSS frames (a plain ref, not frame()-local) so the glide
  // survives idle-frame skips; `eased_init_ref` snaps the very first live frame straight to the target so
  // the map doesn't spin in from zero on mount.
  const eased_theta_ref = useRef(0)
  const eased_init_ref = useRef(false)

  // Warm the engine colour table once (first world_minimap_column triggers a one-shot map-colour bake) off idle.
  useEffect(() => {
    if (!enabled) return undefined
    const warm = () => {
      try {
        world_minimap_column(0, 0)
      } catch {
        /* pre-boot gen — the resample effect retries once pose exists */
      }
    }
    const id =
      typeof requestIdleCallback === 'function' ? requestIdleCallback(warm, { timeout: 1500 }) : setTimeout(warm, 200)
    return () => (typeof cancelIdleCallback === 'function' ? cancelIdleCallback(id) : clearTimeout(id))
  }, [enabled])

  // LAZY RESAMPLE — rebuild the cached relief grid centred on the player's current cell.
  useEffect(() => {
    if (!enabled || cell_key == null) return
    const pose = context.get_state().player_pose
    if (!pose) return
    try {
      grid_ref.current = sample_relief_grid(pose.x, pose.z, tex_span, sample_n, world_minimap_column, grid_ref.current ?? undefined)
      grid_ver_ref.current += 1
    } catch (err) {
      console.warn('[minimap] terrain resample failed', err) // no silent blank map
    }
  }, [enabled, cell_key, world_id, tex_span, sample_n])

  // PER-FRAME DRAW — re-project only when the (eased) yaw/position moved (or the grid was just resampled).
  useEffect(() => {
    if (!enabled) return undefined
    const canvas = canvas_ref.current
    if (!canvas) return undefined
    const ctx = setup_dpr_canvas(canvas, size) // round 5: "stays crisp" — DPR-scaled backing store
    if (!ctx) return undefined
    let raf = 0
    let last_yaw = NaN
    let last_x = NaN
    let last_z = NaN
    let last_ver = -1
    let last_markers = null
    let last_ts = 0
    eased_init_ref.current = false
    const frame_body = (ts) => {
      raf = requestAnimationFrame(frame)
      const pose = context.get_state().player_pose
      const grid = grid_ref.current
      if (!pose || !grid) return
      const target_theta = MAP_YAW_SIGN * (pose.yaw ?? 0) + MAP_YAW_OFFSET
      if (!eased_init_ref.current) {
        eased_theta_ref.current = target_theta // snap the first live frame — no spin-in from zero on mount
        eased_init_ref.current = true
      }
      const dt_ms = last_ts ? Math.min(64, ts - last_ts) : 16.7 // clamp a tab-refocus stall so it can't lerp-snap
      last_ts = ts
      eased_theta_ref.current = angle_lerp(eased_theta_ref.current, target_theta, dt_ms, YAW_EASE_TAU_MS)
      const theta = eased_theta_ref.current
      // skip idle frames — but always repaint while the EASE hasn't caught up yet (the settle tail after a
      // turn stops), or the terrain/camera/position/markers changed (a marker hover/spawn update alters
      // markers_ref without moving the player).
      const settled = Math.abs(theta - target_theta) < YAW_EPS
      const still =
        settled &&
        grid_ver_ref.current === last_ver &&
        markers_ref.current === last_markers &&
        Math.abs(target_theta - last_yaw) < YAW_EPS &&
        Math.abs(pose.x - last_x) < POS_EPS &&
        Math.abs(pose.z - last_z) < POS_EPS
      if (still) return
      last_yaw = target_theta
      last_x = pose.x
      last_z = pose.z
      last_ver = grid_ver_ref.current
      last_markers = markers_ref.current
      render_oblique(ctx, grid, {
        size,
        ppb,
        tilt: MAP_TILT,
        height_scale,
        theta,
        player_x: pose.x,
        player_z: pose.z,
        cx,
        cy,
        markers: markers_ref.current,
      })
    }
    const frame = instrument_cpu_callback('render', frame_body)
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [enabled, size, ppb, height_scale, canvas_ref, cx, cy])
}
