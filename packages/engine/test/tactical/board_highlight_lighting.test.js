// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// NIGHT-UNLIT — fight-board cell highlights are UI-class overlays: their color must be CONSTANT
// regardless of scene lighting / day-night. Root cause of "at night the highlights lost their color":
// three's NodeMaterial.setupOutput mixes scene.fogNode into ANY material whose `.fog` is true (the
// Material default) — independently of `toneMapped`. The board group is added to the MAIN scene, whose
// fogNode carries the day-night aerial haze, so at NIGHT the dark fog drains every highlight's color.
// The whole highlight family must opt out of fog (mat.fog === false) — the same idiom three itself uses
// for lighting-exempt overlays. These locks are the fog axis; toneMapped===false (already present) is the
// tone-map axis. Headless-valid: MeshBasicNodeMaterial constructs under bun (the TSL fragment only
// compiles at render); the canvas-texture factories return null under no-document and the materials
// handle it (see board_highlight_materials.js guards).

import { test, expect, describe } from 'bun:test'
import { Group, Mesh, NormalBlending, PerspectiveCamera, Scene } from 'three'
import { vec4 } from 'three/tsl'

import {
  BOARD_HIGHLIGHT_LAYER,
  create_highlight_overlay,
  route_board_highlight_overlay,
} from '../../src/render/board_highlight_overlay_pass.js'
import { EXPOSURE_BASELINE } from '../../src/render/lighting/auto_exposure.js'
import { CELL_FLOOR } from '../../src/tactical/board.js'
import { CHANNELS, TRAP_BLOB_COLOR, create_board_highlights } from '../../src/tactical/board_highlights.js'
import {
  TRAP_SPIKE_COLOR,
  make_entity_anchor_material,
  make_gradient_tile_material,
  make_outline_material,
  make_trap_blob_material,
  make_trap_spike_material,
} from '../../src/tactical/board_highlight_materials.js'

const TILE_SPEC = { color: 0x4a9eff, opacity: 0.5 }

// Every highlight surface the fight board paints, with the factory that builds its material.
// (move/spell/path/aoe washes all share make_gradient_tile_material; the emphasis feel-cue is covered
//  through the live controller below since its factory is module-private.)
/** @type {[string, () => any][]} */
const FAMILY = [
  ['gradient tile wash (move / spell range / path / aoe preview)', () => make_gradient_tile_material(TILE_SPEC).mat],
  ['entity anchor (cell-under-fighter marker)', () => make_entity_anchor_material(0x4a9eff)],
  ['selection-diamond outline', () => make_outline_material(TILE_SPEC, null)],
  ['trap dark highlight (base)', () => make_trap_blob_material()],
  ['trap spike (accent)', () => make_trap_spike_material()],
]

describe('night-unlit — every highlight material is fog-exempt (lighting-immune)', () => {
  for (const [name, make] of FAMILY) {
    test(`${name}: mat.fog === false (does not drink the night fogNode)`, () => {
      expect(make().fog).toBe(false)
    })

    test(`${name}: unlit + tone-map-exempt contract intact`, () => {
      const mat = make()
      expect(mat.isMeshBasicNodeMaterial).toBe(true) // unlit class — no scene-light response
      expect(mat.toneMapped).toBe(false)
    })
  }

  // [#1043] the marker's IDENTITY moved to the spike (the base is now a deliberately dark cell — the gold base
  // was invisible against the paving). Unlit is what keeps that identity alive at midnight, and every material
  // above is asserted fog/tone-map exempt: a dark base here is a chosen paint, never a night silhouette.
  test('the trap SPIKE carries the semantic trap identity; the base is deliberately darker', () => {
    expect(TRAP_SPIKE_COLOR).toBe(CHANNELS.trap.color)
    expect(TRAP_BLOB_COLOR).not.toBe(CHANNELS.trap.color)
  })
})

function stub_board() {
  const cell_size = 2
  return {
    cell_size,
    origin: { x: 0, y: 0, z: 0 },
    cell_byte: () => CELL_FLOOR,
    cell_center_world: (/** @type {number} */ x, /** @type {number} */ y) =>
      /** @type {[number, number, number]} */ ([(x + 0.5) * cell_size, 0, (y + 0.5) * cell_size]),
  }
}

describe('night-unlit — the live board paints zero fog-lit materials', () => {
  test('feel-cue emphasis + persistent trap meshes: every painted material is fog-exempt', () => {
    const ctrl = create_board_highlights(stub_board())
    ctrl.pulse_cells([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]) // spawns emphasis (feel-cue) meshes into the group
    ctrl.flash([{ x: 2, y: 2 }]) // broad turn-start flash — more emphasis meshes

    /** @type {Set<any>} */
    const mats = new Set()
    ctrl.group.traverse((/** @type {any} */ o) => {
      if (o.material) mats.add(o.material)
    })

    expect(mats.size).toBeGreaterThan(0) // guard: the traversal actually reached painted materials
    for (const m of mats) expect(m.fog).toBe(false)
    ctrl.dispose()
  })
})

// ── POST-AgX OVERLAY ROUTING (the night-wash fix) ── fog-exemption (above) killed the night fog draining the
// colour; but the whole composite is still AgX-tonemapped with a LIVE auto-exposure, so at night the servo
// pushes highlights into AgX's desaturating shoulder → they wash out anyway. The fix moves highlights onto a
// dedicated layer that the AgX main pass EXCLUDES; board_highlight_overlay_pass.js composites them post-AgX at
// a FIXED exposure. route_board_highlight_overlay is the pure hand that does the layer + occlusion-depth
// routing (mirrors vfx_preset_engine.route_overlay_group). Tested with fake-material meshes (no GPU). ────────
describe('route_board_highlight_overlay — POST-AgX board-highlight overlay routing (night-wash fix)', () => {
  /** a stand-in NodeMaterial — route_board_highlight_overlay only reads/writes these three fields. */
  const fake_mat = () => /** @type {any} */ ({ blending: NormalBlending, depthWrite: false, depthTest: true })

  test('BOARD_HIGHLIGHT_LAYER is a dedicated layer — not 0 (default) / not 10 (FIGHT_VFX) / not 31 (webgl park)', () => {
    expect(BOARD_HIGHLIGHT_LAYER).toBeGreaterThan(0)
    expect(BOARD_HIGHLIGHT_LAYER).not.toBe(10)
    expect(BOARD_HIGHLIGHT_LAYER).not.toBe(31)
  })

  test('routes every mesh in the subtree to the overlay layer + occlusion depth flags; groups (no material) contribute 0', () => {
    const root = new Group()
    const wash = new Mesh(undefined, fake_mat())
    const trap = new Group() // the compound trap marker (a dark blob + an upright spike)
    const blob = new Mesh(undefined, fake_mat())
    const spike = new Mesh(undefined, fake_mat())
    trap.add(blob, spike)
    root.add(wash, trap)
    for (const mesh of [wash, blob, spike]) {
      // A future factory is allowed to arrive with hostile defaults. The board-overlay route is the
      // standing-law boundary and must erase both shadow axes rather than relying on Mesh defaults.
      mesh.castShadow = true
      mesh.receiveShadow = true
    }

    expect(route_board_highlight_overlay(root)).toBe(3) // wash + blob + spike; the two Groups carry no material

    for (const mesh of [wash, blob, spike]) {
      expect(mesh.castShadow).toBe(false)
      expect(mesh.receiveShadow).toBe(false)
      expect(mesh.material.depthWrite).toBe(true) // records a representative floor depth for the occlusion mask
      expect(mesh.material.depthTest).toBe(false) // overlapping washes still BLEND by renderOrder (none occlude)
      expect(mesh.material.blending).toBe(NormalBlending) // UNCHANGED — an alpha wash, NOT the VFX additive glow
    }
  })

  test('a routed mesh is INVISIBLE to a default (layer-0) camera and seen only by the overlay camera', () => {
    const mesh = new Mesh(undefined, fake_mat())
    route_board_highlight_overlay(mesh)
    const main_cam = new PerspectiveCamera() // default mask = layer 0 → the AgX main scene pass
    const overlay_cam = new PerspectiveCamera()
    overlay_cam.layers.set(BOARD_HIGHLIGHT_LAYER) // the isolated post-AgX overlay pass
    expect(mesh.layers.test(main_cam.layers)).toBe(false) // NEVER tonemapped by the main pass ⇒ no night wash
    expect(mesh.layers.test(overlay_cam.layers)).toBe(true) // rendered by the display-space overlay pass
  })
})

describe('the LIVE board paints every highlight mesh onto the POST-AgX overlay layer (never the AgX main pass)', () => {
  test('washes + trap marker + selection outline + feel-cue + entity anchor ALL route to BOARD_HIGHLIGHT_LAYER', () => {
    const ctrl = create_board_highlights(stub_board())
    ctrl.set_channel(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      'highlight'
    ) // a gradient wash channel
    ctrl.set_channel([{ x: 2, y: 0 }], 'trap') // the compound blob + spike marker (a Group tile)
    ctrl.set_channel([{ x: 3, y: 0 }], 'selection') // the outline diamond
    ctrl.pulse_cells([{ x: 0, y: 1 }]) // a feel-cue emphasis mesh
    ctrl.set_entity_anchor('e1', { x: 1, z: 1 }, 0) // the entity anchor marker

    const main_cam = new PerspectiveCamera() // default layer-0 mask = the AgX main scene pass
    const overlay_cam = new PerspectiveCamera()
    overlay_cam.layers.set(BOARD_HIGHLIGHT_LAYER)

    /** @type {any[]} */
    const meshes = []
    ctrl.group.traverse((/** @type {any} */ o) => {
      if (o.material) meshes.push(o)
    })

    expect(meshes.length).toBeGreaterThan(0) // guard: the traversal actually reached painted meshes
    for (const m of meshes) {
      expect(m.layers.test(main_cam.layers)).toBe(false) // excluded from the AgX main pass ⇒ no night wash
      expect(m.layers.test(overlay_cam.layers)).toBe(true) // rendered by the post-AgX overlay pass
    }
    ctrl.dispose()
  })
})

describe('create_highlight_overlay — fixed-exposure post-AgX contract (the actual night-wash cure)', () => {
  const make = () =>
    create_highlight_overlay({
      scene: new Scene(),
      camera: new PerspectiveCamera(),
      scene_depth: /** @type {any} */ ({ r: 0 }),
    })

  test('tonemaps highlights at a FIXED exposure = EXPOSURE_BASELINE (decoupled from the live auto-exposure servo)', () => {
    // THIS is what stops the wash: the overlay re-tonemaps with AgX at a CONSTANT exposure, so the 0.85–1.4
    // night swing that drove renderer.toneMappingExposure can no longer reach the highlight colour.
    expect(make().exposure.value).toBe(EXPOSURE_BASELINE)
  })

  test('composite() WRAPS the passed display frame (an OVER onto the graded output — not a pass-through/replacement)', () => {
    const ov = make()
    const graded = vec4(0.1, 0.2, 0.3, 1) // a real TSL node standing in for post_stack's graded `out`
    const out = ov.composite(graded)
    expect(out).toBeTruthy()
    expect(out).not.toBe(graded) // it composes a NEW node OVER the frame (proves a real composite is wired)
  })
})
