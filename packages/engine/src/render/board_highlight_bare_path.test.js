// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// BARE-RENDER PATH (#1175) — the fight board must still be PAINTED when there is no post stack. Layer 11 is
// rendered by exactly one thing: the post stack's highlight overlay pass. On the bare path (`post` null — hack
// mode's `atmosphere: false`, or the post-stack construction-failure catch on WebGL2-only / no-WebGPU GPUs) that
// pass does not exist and the camera keeps its default layer-0 mask, so a highlight routed to layer 11 is drawn
// by NOTHING: placement bands, cell blobs and hover paints all went dark on a byte-healthy projection (driven,
// as alice, on the served bundle). The fix teaches the ROUTER the render path — one door, both bare sites — so
// with no overlay pass the paints stay on the default layer with the flags board_highlight_materials.js authors
// (transparent, depthWrite OFF, depthTest ON) and the main pass draws them, the pre-overlay in-scene look.
// Headless-valid: pure layer/material bookkeeping + the live controller (its materials construct under bun).

import { readFileSync } from 'node:fs'

import { afterAll, describe, expect, test } from 'bun:test'
import { Group, Mesh, NormalBlending, PerspectiveCamera } from 'three'

import { CELL_FLOOR } from '../tactical/board.js'
import { create_board_highlights } from '../tactical/board_highlights.js'

import {
  BOARD_HIGHLIGHT_LAYER,
  route_board_highlight_overlay,
  set_board_highlight_overlay_mounted,
} from './board_highlight_overlay_pass.js'

/** a stand-in NodeMaterial carrying the flags board_highlight_materials.js authors (see its make_* factories). */
const authored_mat = () => /** @type {any} */ ({ blending: NormalBlending, depthWrite: false, depthTest: true })

/** the minimal board surface create_board_highlights reads (mirrors the lighting suite's stub). */
const stub_board = () => ({
  cell_size: 2,
  origin: { x: 0, y: 0, z: 0 },
  cell_byte: () => CELL_FLOOR,
  cell_center_world: (/** @type {number} */ x, /** @type {number} */ y) =>
    /** @type {[number, number, number]} */ ([(x + 0.5) * 2, 0, (y + 0.5) * 2]),
})

// The router's path flag is module state (one renderer per page, set once at boot). Every test below sets it
// explicitly, and this restores the healthy default so suite ORDER can never leak a bare-path flag into the
// overlay-routing suites (board_highlight_lighting.test.js asserts the layer-11 routing).
afterAll(() => set_board_highlight_overlay_mounted(true))

describe('#1175 — with NO post stack the board highlights render in the MAIN pass', () => {
  test('routed meshes stay on the default layer, so a plain layer-0 camera SEES them', () => {
    set_board_highlight_overlay_mounted(false)
    const mesh = new Mesh(undefined, authored_mat())
    route_board_highlight_overlay(mesh)

    const bare_cam = new PerspectiveCamera() // the bare path renders with the camera's DEFAULT mask
    expect(mesh.layers.test(bare_cam.layers)).toBe(true) // ⇐ the whole bug: false meant "painted by nothing"
    expect(mesh.layers.isEnabled(BOARD_HIGHLIGHT_LAYER)).toBe(false) // no pass renders 11 here — never route there
  })

  test('the authored depth flags survive — a main-pass wash keeps depthWrite OFF and depthTest ON', () => {
    set_board_highlight_overlay_mounted(false)
    const mesh = new Mesh(undefined, authored_mat())
    route_board_highlight_overlay(mesh)

    // The overlay's depthWrite ON / depthTest OFF pair only makes sense INSIDE the isolated pass (it feeds the
    // composite's occlusion mask). Forced onto the main pass they would make a transparent wash write depth and
    // paint through fighters' bodies. Per-order WASH_LIFT already stacks the channels in Y, so real depth
    // ordering keeps one blob per cell with target-red above range-blue.
    expect(mesh.material.depthWrite).toBe(false)
    expect(mesh.material.depthTest).toBe(true)
    expect(mesh.material.blending).toBe(NormalBlending) // still an alpha wash, never the VFX additive glow
  })

  test('the shadow axes are closed on EVERY path — a paint never casts or receives', () => {
    set_board_highlight_overlay_mounted(false)
    const mesh = new Mesh(undefined, authored_mat())
    mesh.castShadow = true // a hostile factory default
    mesh.receiveShadow = true
    expect(route_board_highlight_overlay(mesh)).toBe(1)
    expect(mesh.castShadow).toBe(false)
    expect(mesh.receiveShadow).toBe(false)
  })

  test('the LIVE board: every painted mesh is visible to the bare camera (washes, trap, outline, cue, anchor)', () => {
    set_board_highlight_overlay_mounted(false)
    const ctrl = create_board_highlights(stub_board())
    ctrl.set_channel(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      'highlight'
    ) // the placement/range wash family
    ctrl.set_channel([{ x: 2, y: 0 }], 'trap') // compound blob + spike Group
    ctrl.set_channel([{ x: 3, y: 0 }], 'selection') // the outline diamond (hover/selection)
    ctrl.pulse_cells([{ x: 0, y: 1 }]) // a feel-cue emphasis mesh
    ctrl.set_entity_anchor('e1', { x: 1, z: 1 }, 0)

    const bare_cam = new PerspectiveCamera()
    /** @type {any[]} */
    const meshes = []
    ctrl.group.traverse((/** @type {any} */ o) => {
      if (o.material) meshes.push(o)
    })

    expect(meshes.length).toBeGreaterThan(0) // guard: the traversal actually reached painted meshes
    for (const m of meshes) expect(m.layers.test(bare_cam.layers)).toBe(true)
    ctrl.dispose()
  })
})

describe('POSITIVE CONTROL — with the post stack mounted the layer-11 routing is unchanged', () => {
  test('a routed subtree moves to BOARD_HIGHLIGHT_LAYER with the overlay depth flags', () => {
    set_board_highlight_overlay_mounted(true)
    const root = new Group()
    const wash = new Mesh(undefined, authored_mat())
    const trap = new Group()
    const blob = new Mesh(undefined, authored_mat())
    trap.add(blob)
    root.add(wash, trap)

    expect(route_board_highlight_overlay(root)).toBe(2) // the two Groups carry no material

    const main_cam = new PerspectiveCamera()
    const overlay_cam = new PerspectiveCamera()
    overlay_cam.layers.set(BOARD_HIGHLIGHT_LAYER)
    for (const mesh of [wash, blob]) {
      expect(mesh.layers.test(main_cam.layers)).toBe(false) // excluded from the AgX main pass ⇒ no night wash
      expect(mesh.layers.test(overlay_cam.layers)).toBe(true)
      expect(mesh.material.depthWrite).toBe(true)
      expect(mesh.material.depthTest).toBe(false)
    }
  })
})

// ONE HOME: the renderer resolves the path once, where `post`'s fate is known — after the try/catch — so both
// bare sites (hack mode's `atmosphere: false` skip and the construction-failure catch) are covered by the same
// call. A second compensation, or one moved back INSIDE the try, is the class of bug this seals.
describe('renderer wiring — the router is told the render path exactly once, after the try/catch', () => {
  const renderer_source = readFileSync(new URL('../core/renderer.js', import.meta.url), 'utf8')

  test('create_renderer calls set_board_highlight_overlay_mounted(post !== null) once, outside the try', () => {
    const calls = renderer_source.match(/set_board_highlight_overlay_mounted\(/g) ?? []
    expect(calls.length).toBe(1)
    expect(renderer_source).toContain('set_board_highlight_overlay_mounted(post !== null)')
    // positioned AFTER the degradation catch (whose warn is the last statement of the catch block) ⇒ it runs on
    // the healthy path, the hack-mode path, and the failure path alike.
    const catch_warn = renderer_source.indexOf('[renderer] atmosphere/post stack failed to construct')
    expect(catch_warn).toBeGreaterThan(0)
    expect(renderer_source.indexOf('set_board_highlight_overlay_mounted(post !== null)')).toBeGreaterThan(catch_warn)
  })
})
