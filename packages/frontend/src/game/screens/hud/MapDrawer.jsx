// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// World map — a lazy pan/zoom blit of the real @aresrpg/sim 2000x2000 seeded world, colored per biome
// cell (the same terrain SSOT as the HUD minimap, via worldmap-data.js / biome-colors.js), with the
// live player marker on top. Drag to pan, scroll to zoom around the cursor, Recenter to snap back to
// the player. A PURE terrain render: no server data, no overlays, no fast-travel — just the colored
// world and where you are. Base chrome (.map / .map__bar / .map__stage / .map__canvas) lives in map.css.

import { useCallback, useEffect, useRef, useState } from 'react'

import { WORLD_SEED } from '@aresrpg/sim/world'

import { CANVAS_H, CANVAS_W, MAP_PX, sample_world, world_to_screen } from './worldmap-data.js'
import { useGameState } from '../../store.js'
import './hud-panels.css'
import './map.css'
import './worldmap.css'

/** @typedef {{ zoom: number, ox: number, oy: number }} View */
/** @typedef {{ width: number, height: number }} Canvas_Size */

// Smallest zoom = the bitmap exactly filling the canvas (no black borders past the world edge —
// "cannot dezoom too far"). Computed from the live canvas at any drawer size.
const min_zoom_for = (/** @type {Canvas_Size} */ cv) => Math.max(cv.width, cv.height) / MAP_PX

// Clamp zoom to [min_fill, 8] and pan so the bitmap keeps covering the canvas. Pure: view in, new view out —
// the ref that holds the live view is written once at the event edge, never through.
export const clamp_view = (/** @type {Canvas_Size} */ cv, /** @type {View} */ v) => {
  const zoom = Math.max(min_zoom_for(cv), Math.min(8, v.zoom))
  const map_w = MAP_PX * zoom
  return {
    zoom,
    ox: Math.min(0, Math.max(cv.width - map_w, v.ox)),
    oy: Math.min(0, Math.max(cv.height - map_w, v.oy)),
  }
}

// Center on the player at a comfortable zoom (2x fill) — the "find me" view. No player: center the world.
export const center_on_player = (
  /** @type {Canvas_Size} */ cv,
  /** @type {{ x: number, y: number } | null | undefined} */ p,
) => {
  const zoom = min_zoom_for(cv) * 2
  if (p) {
    const { sx, sy } = world_to_screen(p.x, p.y, { zoom, ox: 0, oy: 0 })
    return clamp_view(cv, { zoom, ox: cv.width / 2 - sx, oy: cv.height / 2 - sy })
  }
  return clamp_view(cv, { zoom, ox: (cv.width - MAP_PX * zoom) / 2, oy: (cv.height - MAP_PX * zoom) / 2 })
}

/**
 * Full-screen colored terrain map: a cached pan/zoom blit of the seeded world with the live player
 * marker. Drag to pan, scroll to zoom around the cursor, Recenter to snap back to the player.
 * @returns {import('react').JSX.Element}
 */
export function MapDrawer() {
  const player_cell = useGameState((s) => s.player_cell)
  const seed = player_cell?.seed ?? WORLD_SEED

  const canvas_ref = useRef(/** @type {HTMLCanvasElement | null} */ (null))
  const bitmap_ref = useRef(/** @type {HTMLCanvasElement | null} */ (null))
  const view_ref = useRef({ zoom: 1, ox: 0, oy: 0 }) // ox/oy: pan offset in canvas-internal px
  const drag_ref = useRef(/** @type {{ x: number, y: number } | null} */ (null))
  const [ready, set_ready] = useState(false)
  const [view_version, set_view_version] = useState(0) // bumped (rAF-coalesced) on any view change

  // Latest player cell in a ref so the resample effect and Recenter can feed it to center_on_player
  // without re-subscribing.
  const player_ref = useRef(player_cell)
  player_ref.current = player_cell

  // Coalesce overlay re-renders to one per animation frame (drag/zoom swap view_ref.current directly).
  const bump_raf = useRef(0)
  const bump = useCallback(() => {
    if (bump_raf.current) return
    bump_raf.current = requestAnimationFrame(() => {
      bump_raf.current = 0
      set_view_version((v) => v + 1)
    })
  }, [])

  // 1) Lazy one-pass sample of the world into an offscreen canvas (deferred so opening never janks).
  useEffect(() => {
    set_ready(false)
    let cancelled = false
    const id = requestAnimationFrame(() => {
      if (cancelled) return
      const off = document.createElement('canvas')
      off.width = MAP_PX
      off.height = MAP_PX
      const octx = off.getContext('2d')
      if (!octx) return
      octx.putImageData(sample_world(octx, seed), 0, 0)
      bitmap_ref.current = off
      const cv = canvas_ref.current
      if (cv) view_ref.current = center_on_player(cv, player_ref.current)
      set_ready(true)
      bump()
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bump is stable ([] useCallback) and the view helpers are module-scope pure; listing them would rerun this seed-triggered resample for no behavior change
  }, [seed])

  // 2) Blit the cached terrain bitmap at the current view (re-runs on every view change; no rAF loop —
  //    the player pulse is a CSS-animated overlay element, so the canvas only repaints when the view does).
  useEffect(() => {
    if (!ready) return
    const cv = canvas_ref.current
    const bmp = bitmap_ref.current
    if (!cv || !bmp) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const { zoom, ox, oy } = view_ref.current
    ctx.fillStyle = '#07090d' // letterbox
    ctx.fillRect(0, 0, cv.width, cv.height)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(bmp, ox, oy, MAP_PX * zoom, MAP_PX * zoom)
  }, [ready, view_version])

  // wheel-to-zoom around the cursor — a NON-passive native listener (React onWheel is passive).
  useEffect(() => {
    const cv = canvas_ref.current
    if (!cv) return
    /** @param {WheelEvent} e */
    const on_wheel = (e) => {
      e.preventDefault()
      const rect = cv.getBoundingClientRect()
      // map the cursor from displayed px to canvas-internal px (the canvas is CSS-stretched).
      const cxp = ((e.clientX - rect.left) / rect.width) * cv.width
      const cyp = ((e.clientY - rect.top) / rect.height) * cv.height
      const v = view_ref.current
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
      const next = Math.max(min_zoom_for(cv), Math.min(8, v.zoom * factor))
      const k = next / v.zoom
      view_ref.current = clamp_view(cv, {
        zoom: next,
        ox: cxp - (cxp - v.ox) * k,
        oy: cyp - (cyp - v.oy) * k,
      })
      bump()
    }
    cv.addEventListener('wheel', on_wheel, { passive: false })
    return () => cv.removeEventListener('wheel', on_wheel)
  }, [bump])

  // drag-to-pan (pointer deltas are in displayed px -> scale to canvas-internal px)
  const scale_factor = () => {
    const cv = canvas_ref.current
    const rect = cv?.getBoundingClientRect()
    return rect && rect.width ? cv.width / rect.width : 1
  }
  const on_down = (/** @type {import('react').PointerEvent} */ e) => {
    drag_ref.current = { x: e.clientX, y: e.clientY }
  }
  const on_move = (/** @type {import('react').PointerEvent} */ e) => {
    if (!drag_ref.current) return
    const cv = canvas_ref.current
    const k = scale_factor()
    const v = view_ref.current
    const panned = {
      zoom: v.zoom,
      ox: v.ox + (e.clientX - drag_ref.current.x) * k,
      oy: v.oy + (e.clientY - drag_ref.current.y) * k,
    }
    view_ref.current = cv ? clamp_view(cv, panned) : panned
    drag_ref.current = { x: e.clientX, y: e.clientY }
    bump()
  }
  const on_up = () => {
    drag_ref.current = null
  }

  const recenter = () => {
    const cv = canvas_ref.current
    if (cv) view_ref.current = center_on_player(cv, player_ref.current)
    bump()
  }

  // World cell -> CSS % over the CSS-stretched canvas (re-read each render via view_version).
  const view = view_ref.current
  const to_pct = (/** @type {number} */ x, /** @type {number} */ z) => {
    const { sx, sy } = world_to_screen(x, z, view)
    return { left: `${(sx / CANVAS_W) * 100}%`, top: `${(sy / CANVAS_H) * 100}%` }
  }

  return (
    <div className="map">
      <div className="map__bar">
        <span className="map__region">World</span>
        <span className="map__coords hud-num">{player_cell ? `${player_cell.x}, ${player_cell.y}` : 'locating'}</span>
        <button type="button" className="hud-btn map__recenter" onClick={recenter}>
          Recenter
        </button>
      </div>

      <div className="map__stage">
        <canvas
          ref={canvas_ref}
          className="map__canvas"
          width={CANVAS_W}
          height={CANVAS_H}
          onPointerDown={on_down}
          onPointerMove={on_move}
          onPointerUp={on_up}
          onPointerLeave={on_up}
        />

        {ready && player_cell && (
          <div className="map__overlay">
            <span className="map__player" style={to_pct(player_cell.x, player_cell.y)} aria-hidden="true">
              <span className="map__player-ring" />
              <span className="map__player-dot" />
            </span>
          </div>
        )}

        {!ready && <div className="map__loading">Loading map</div>}
      </div>
    </div>
  )
}
