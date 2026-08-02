// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2069 — MapDrawer's view math used to be written THROUGH the ref that holds it: `clamp_view(cv)` and
// `center_on_player(cv)` each read `view_ref.current` and assigned `v.zoom` / `v.ox` / `v.oy` in place, so
// the map's whole pan/zoom law lived in 13 field mutations of one long-lived object and could not be
// exercised without mounting the component, a canvas, and a pointer.
//
// They are now pure: canvas size + view in, a NEW view out — the ref is written once at each event edge.
// That makes the law itself testable, which is what this file pins. No React, no DOM, no canvas: the
// helpers only ever read `width`/`height`, so a plain object is a faithful stand-in.
//
// The invariants under test are the ones a player feels:
//   - "cannot dezoom too far" — zoom never drops below the bitmap exactly filling the canvas,
//   - no black borders past the world edge — pan always keeps the bitmap covering the canvas,
//   - Recenter puts the player under the middle of the screen.
// Expectations are DERIVED through `world_to_screen` / `MAP_PX` rather than hardcoded, so the terrain
// SSOT stays the one home for those numbers.

import { describe, expect, test } from 'bun:test'

import { CANVAS_H, CANVAS_W, MAP_PX, world_to_screen } from '../../../../src/game/screens/hud/worldmap-data.js'
import { center_on_player, clamp_view } from '../../../../src/game/screens/hud/MapDrawer.jsx'

const cv = { width: CANVAS_W, height: CANVAS_H }
const min_zoom = Math.max(cv.width, cv.height) / MAP_PX

describe('clamp_view', () => {
  test('raises zoom to the fill floor — dezooming past the world edge is impossible', () => {
    const out = clamp_view(cv, { zoom: 0.01, ox: 0, oy: 0 })

    expect(out.zoom).toBe(min_zoom)
    // at the floor the bitmap is exactly the canvas, so the only covering pan is the origin
    expect(out.ox).toBe(0)
    expect(out.oy).toBe(0)
  })

  test('caps zoom at 8', () => {
    expect(clamp_view(cv, { zoom: 1e6, ox: 0, oy: 0 }).zoom).toBe(8)
  })

  test('pans back so the bitmap keeps covering the canvas on both sides', () => {
    const zoom = 8
    const map_w = MAP_PX * zoom

    // pushed off the top/left: the bitmap would expose a gap before the world starts -> pinned to 0
    const over = clamp_view(cv, { zoom, ox: 1e6, oy: 1e6 })
    expect(over.ox).toBe(0)
    expect(over.oy).toBe(0)

    // pushed off the bottom/right: pinned to the last covering offset, never further
    const under = clamp_view(cv, { zoom, ox: -1e6, oy: -1e6 })
    expect(under.ox).toBe(cv.width - map_w)
    expect(under.oy).toBe(cv.height - map_w)
  })

  test('leaves an already-covering view untouched and is idempotent', () => {
    const inside = { zoom: 4, ox: -100, oy: -120 }
    const once = clamp_view(cv, inside)

    expect(once).toEqual(inside)
    expect(clamp_view(cv, once)).toEqual(once)
  })

  test('returns a new view and never writes through its input', () => {
    const input = Object.freeze({ zoom: 0.01, ox: 1e6, oy: 1e6 })

    // a mutating implementation throws on the frozen object (ESM is strict mode)
    const out = clamp_view(cv, input)

    expect(out).not.toBe(input)
    expect(input).toEqual({ zoom: 0.01, ox: 1e6, oy: 1e6 })
  })
})

describe('center_on_player', () => {
  test('puts the player under the middle of the screen', () => {
    const p = { x: 0, y: 0 } // world center — far from any edge, so the clamp never bites
    const view = center_on_player(cv, p)
    const { sx, sy } = world_to_screen(p.x, p.y, view)

    expect(sx).toBeCloseTo(cv.width / 2, 6)
    expect(sy).toBeCloseTo(cv.height / 2, 6)
    expect(view.zoom).toBe(min_zoom * 2)
  })

  test('with no player, centers the world instead of leaving a corner view', () => {
    const zoom = min_zoom * 2
    const view = center_on_player(cv, null)

    expect(view.zoom).toBe(zoom)
    expect(view.ox).toBe((cv.width - MAP_PX * zoom) / 2)
    expect(view.oy).toBe((cv.height - MAP_PX * zoom) / 2)
  })

  test('always returns an already-clamped view, even for a player at the world edge', () => {
    for (const p of [null, { x: 0, y: 0 }, { x: -1e6, y: -1e6 }, { x: 1e6, y: 1e6 }]) {
      const view = center_on_player(cv, p)

      expect(clamp_view(cv, view)).toEqual(view)
    }
  })
})
