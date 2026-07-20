// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Expanded MAP MODAL — the big map (click-to-open from the minimap), presented like a modal on top of
// everything, with no gold ring or border chrome.
// The ring/border chrome (.mmx-ring) is GONE outright — the map's own edge is the only boundary now (the same
// no-frame convention the small map's lens already had since round 5); the close button (✕) keeps floating
// frameless. TRUE MODAL: this now portals straight to document.body (createPortal — the same idiom as
// FundWalletModal/PetFeedModal/ConfirmDialog) at a z-index above every HUD panel/toast/tooltip (see
// minimap.css .mmx-backdrop), fixed + CENTERED OVER THE FULL BROWSER VIEWPORT rather than the game sub-area
// beside the sidebar (see use_viewport_size, replacing round 5's game-area rect measurement — there's no
// "game area" left to measure once the map floats above the sidebar too). Sizing stays 70% (now of the
// viewport); there is still NO dark scrim (the world stays visible around it, standing order); Esc +
// click-outside-to-close both still work, untouched by the re-parenting.
//
// The big map renders a FLAT 2D view, "from a real distance" (not 3D) — ZERO 3-D anywhere (no oblique, no
// extrusion, no side walls —
// render_flat_terrain/render_flat_overlay, the SAME flat renderer minimap_engine.js exports, called with
// theta=0 so the terrain never rotates — NORTH-UP fixed, the "real map" convention; only the PLAYER ARROW
// rotates, to show facing) at REGION SCALE (768 blocks across, ~3 blocks/texel — a wide reference-map
// window, not the small map's radius blown up). Plus, the interactive entity overlay: mob GROUPS (red) and
// resource NODES (gold), hover for a level/name readout, click to EMIT the marker-click contract a sibling
// lane wires auto-run to.
//
// PERF (measured — see the brief's own math check): a REAL sample_relief_grid + world_minimap_column pass at
// the region-scale settings (768 span, 256x256 = 65536 cells) costs ~95-100ms — too slow for an instant-open
// feel. So this is "a map consult, not a live render" (the brief's own framing), painted with a PROGRESSIVE
// FILL instead of a spinner: a COARSE pass (80x80, ~12ms) samples+paints INSTANTLY on open, then a FINE pass
// (256x256, ~95ms) samples+repaints one tick later, filling in the detail. Both passes run ONCE per open —
// the terrain never re-samples or re-projects per frame. The MARKER/ARROW overlay is a SEPARATE, transparent
// canvas layered on top, redrawn only on pose/hover changes (cheap — O(#markers) — never touching the
// (expensive, painted-once) terrain layer underneath it).
//
// MARKER-CLICK CONTRACT (the auto-run lane listens here): on a marker click this emits, on the game bus,
//   context.events.emit('map/auto_run', {
//     type: 'mob' | 'resource', id: spawn_id, position: { x, z },   // world-space blocks (signed) — REQUIRED trio
//     key, template_id, zx, zy, job, tier, name?, level_min?, level_max?   // extra context
//   })
// `position` is the chain spawn ANCHOR (the same coord claim/gather use). The consumer decides the pathing.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { world_minimap_column } from '@aresrpg/engine3'

import { use_game_state, context } from '../../store.js'
import { use_world_spawns } from '../../world_spawns_store.js'
import {
  sample_relief_grid,
  render_flat_terrain,
  render_flat_overlay,
  grid_index_at,
  setup_dpr_canvas,
  MAP_YAW_SIGN,
  MAP_YAW_OFFSET,
} from './minimap_engine.js'
import './minimap.css'

const SIZE_FALLBACK = 440 // pre-measure fallback (first paint, before the viewport size lands)
const SIZE_FRACTION = 0.7 // takes up 70% of the space of the game
const VIEW_RADIUS_BLOCKS = 384 // "from a real distance" — region scale (768-block span), not the small map's radius blown up
const SAMPLE_N = 256 // fine pass — 3 blocks/texel (measured ~95-100ms; see the header)
const COARSE_SAMPLE_N = 80 // instant first paint (measured ~12ms) while the fine pass fills in behind it
const SPAN = 2 * VIEW_RADIUS_BLOCKS
const HIT_R = 10 // marker hit-test radius, px

/** 70% of the live VIEWPORT, square, capped to its SHORTER axis so the map never overflows either edge.
 *  ROUND 6: replaces the round-5 game-area rect measurement — the modal now portals to document.body and
 *  centers over the FULL BROWSER VIEWPORT ("on top of everything"), so there is no longer a
 *  `.gw-hud`-scoped element whose rect IS the game area; window.innerWidth/innerHeight is the honest
 *  reference now. Re-measures on resize while the modal is open.
 *  @returns {number} */
function use_viewport_size() {
  const [size, set_size] = useState(SIZE_FALLBACK)
  useLayoutEffect(() => {
    const measure = () => set_size(Math.round(Math.min(window.innerWidth, window.innerHeight) * SIZE_FRACTION))
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  return size
}

/**
 * @param {{ onClose: () => void }} props
 * @returns {import('react').ReactElement | null}
 */
export function MinimapModal({ onClose }) {
  const pose = use_game_state((s) => s.player_pose)
  const spawns = use_world_spawns((s) => s.spawns)
  const terrain_ref = useRef(/** @type {HTMLCanvasElement | null} */ (null))
  const overlay_ref = useRef(/** @type {HTMLCanvasElement | null} */ (null))
  const [hover, set_hover] = useState(/** @type {null | { key: string, cx: number, cy: number }} */ (null))
  const SIZE = use_viewport_size()
  const ppb = SIZE / SPAN // north-up, no rotation ⇒ the sampled span exactly fills the canvas — no inset math needed

  // The map is a SNAPSHOT centred on wherever the player was AT OPEN (region scale — "a map consult, not a
  // live render"): the terrain never re-samples while open. `origin` anchors both the terrain AND the
  // markers (so they never drift apart); the player ARROW still tracks the LIVE heading (cheap — see below).
  const grid_ref = useRef(/** @type {import('./minimap_engine.js').ReliefGrid | null} */ (null))
  const origin_ref = useRef({ x: 0, z: 0 })
  const [grid_ver, set_grid_ver] = useState(0)

  // ESC closes (modal idiom).
  useEffect(() => {
    const on_key = (/** @type {KeyboardEvent} */ e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', on_key)
    return () => window.removeEventListener('keydown', on_key)
  }, [onClose])

  // PROGRESSIVE FILL — coarse pass paints instantly, the fine pass fills in one tick later (see header PERF
  // note for the measured costs). Runs ONCE per mount (per open), never on a pose/resize cadence.
  useEffect(() => {
    const pose0 = context.get_state().player_pose
    if (!pose0) return undefined
    origin_ref.current = { x: pose0.x, z: pose0.z }
    try {
      grid_ref.current = sample_relief_grid(pose0.x, pose0.z, SPAN, COARSE_SAMPLE_N, world_minimap_column)
      set_grid_ver((v) => v + 1)
    } catch (err) {
      console.warn('[minimap] region coarse sample failed', err) // no silent blank map
    }
    const id = setTimeout(() => {
      try {
        grid_ref.current = sample_relief_grid(pose0.x, pose0.z, SPAN, SAMPLE_N, world_minimap_column, grid_ref.current ?? undefined)
        set_grid_ver((v) => v + 1)
      } catch (err) {
        console.warn('[minimap] region fine sample failed', err)
      }
    }, 0)
    return () => clearTimeout(id)
  }, [])

  // TERRAIN paint — once per (re)sample, never per frame. A SEPARATE canvas from the overlay below so a
  // marker hover (which fires on every pointermove) never re-triggers this expensive pass.
  useEffect(() => {
    const canvas = terrain_ref.current
    const grid = grid_ref.current
    if (!canvas || !grid) return
    const ctx = setup_dpr_canvas(canvas, SIZE)
    if (!ctx) return
    const origin = origin_ref.current
    render_flat_terrain(ctx, grid, { size: SIZE, ppb, theta: 0, player_x: origin.x, player_z: origin.z })
  }, [grid_ver, SIZE, ppb])

  const markers = useMemo(
    () => spawns.map((s) => ({ x: s.x, z: s.z, kind: s.kind, key: s.key, hot: s.key === hover?.key })),
    [spawns, hover]
  )

  // OVERLAY paint — markers + player arrow + north tick. Cheap (O(#markers)): redraws on every pose/hover
  // change with zero cost to the terrain layer. Markers stay pinned to `origin` (matching the terrain, so
  // they never drift off their real spot); the arrow's ROTATION alone tracks the live heading — unlike the
  // small map, the terrain here never rotates, so the arrow rotates instead to show facing (round 5).
  useEffect(() => {
    const canvas = overlay_ref.current
    const grid = grid_ref.current
    if (!canvas || !grid || !pose) return
    const ctx = setup_dpr_canvas(canvas, SIZE)
    if (!ctx) return
    const origin = origin_ref.current
    const heading = MAP_YAW_SIGN * (pose.yaw ?? 0) + MAP_YAW_OFFSET
    render_flat_overlay(ctx, grid, { size: SIZE, ppb, theta: 0, player_x: origin.x, player_z: origin.z, markers, heading })
  }, [pose, markers, grid_ver, SIZE, ppb])

  const spawn_of = (/** @type {string} */ key) => spawns.find((s) => s.key === key) ?? null

  // Hit-test mirrors render_flat_overlay's own marker projection exactly (north-up, pinned to `origin`, no
  // lift/tilt) — a click only ever lands on what's actually drawn there.
  const hit_test = (/** @type {number} */ lpx, /** @type {number} */ lpy) => {
    const grid = grid_ref.current
    if (!grid) return null
    const origin = origin_ref.current
    const c = SIZE / 2
    let best = null
    let best_d2 = HIT_R * HIT_R
    for (const m of markers) {
      const gi = grid_index_at(grid, m.x, m.z)
      if (gi < 0) continue
      const sx = c + (m.x - origin.x) * ppb
      const sy = c + (m.z - origin.z) * ppb
      const d2 = (sx - lpx) ** 2 + (sy - lpy) ** 2
      if (d2 <= best_d2) {
        best_d2 = d2
        best = m
      }
    }
    return best
  }

  const on_move = (/** @type {import('react').PointerEvent<HTMLCanvasElement>} */ e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const hit = hit_test(e.clientX - rect.left, e.clientY - rect.top)
    set_hover(hit ? { key: hit.key, cx: e.clientX - rect.left, cy: e.clientY - rect.top } : null)
  }
  const on_click = (/** @type {import('react').PointerEvent<HTMLCanvasElement>} */ e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const hit = hit_test(e.clientX - rect.left, e.clientY - rect.top)
    if (!hit) return
    const s = spawn_of(hit.key)
    if (!s) return
    // The marker-click contract (see header) — the auto-run lane consumes {type,id,position} on 'map/auto_run'.
    context.events.emit('map/auto_run', {
      type: s.kind,
      id: s.spawn_id,
      position: { x: s.x, z: s.z },
      key: s.key,
      template_id: s.template_id,
      zx: s.zx,
      zy: s.zy,
      job: s.job,
      tier: s.tier,
      name: s.name,
      level_min: s.level_min,
      level_max: s.level_max,
    })
  }

  const hover_spawn = hover ? spawn_of(hover.key) : null
  const hover_label = hover_spawn
    ? hover_spawn.kind === 'mob'
      ? hover_spawn.level_min != null
        ? hover_spawn.level_max && hover_spawn.level_max !== hover_spawn.level_min
          ? `${hover_spawn.level_min}–${hover_spawn.level_max}`
          : `${hover_spawn.level_min}`
        : (hover_spawn.name ?? '')
      : (hover_spawn.name ?? '')
    : ''

  if (!pose) return null

  return createPortal(
    <div className="mmx-backdrop" onClick={onClose}>
      <div
        className="mmx-panel"
        style={{ '--mmx-size': `${SIZE}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="mmx-close" aria-label="Close map" onClick={onClose}>
          ×
        </button>
        <div className="mmx-lens">
          <canvas ref={terrain_ref} className="mmx-canvas mmx-canvas--terrain" width={SIZE} height={SIZE} />
          <canvas
            ref={overlay_ref}
            className="mmx-canvas mmx-canvas--overlay"
            width={SIZE}
            height={SIZE}
            onPointerMove={on_move}
            onPointerLeave={() => set_hover(null)}
            onClick={on_click}
          />
          <span className="mm-scan" aria-hidden="true" />
          {hover && hover_label && (
            <span className="mmx-tip" style={{ left: `${hover.cx}px`, top: `${hover.cy}px` }}>
              {hover_label}
            </span>
          )}
        </div>
        <div className="mmx-legend" aria-hidden="true">
          <span className="mmx-key mmx-key--mob" />
          <span className="mmx-key mmx-key--node" />
        </div>
      </div>
    </div>,
    document.body
  )
}
