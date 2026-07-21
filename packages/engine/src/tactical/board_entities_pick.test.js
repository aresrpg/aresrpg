// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENTITY HOVER = THE CELL RULE (D1): a mob's hitbox must not block clicking the cell behind it —
// hovering in fights uses only the cell hitbox, not the mob model.
//
// LINEAGE: the 07-11 "3 blocks away" fix clamped the old pick cylinder's RADIUS sub-cell, but its HEIGHT
// stayed full-body — this file's own prior NOTE admitted the hover still reached ~2 cells AWAY from the
// camera, exactly where a tall mob's drawn body covers the ground behind it. That residue is the v30 report.
// The rule of record now: the pointer hovers the entity standing ON the plane-picked board cell — one Map
// lookup, no body geometry at all. The floor plane (board_picking) is the ONLY pick surface, so the entity
// hover can never disagree with the cell hover ("cell hitbox only"), at any body height, at any camera pose.
//
// The faux-iso camera scaffold is kept from the cylinder-era file to PROVE the class stays dead end-to-end:
// NDC through the real fight-cam pose over the ground cells around a TALL (boss-height) rig, resolved
// through the same cell_at_ndc plane pick the facade wires (index.js pick_entity), must hover the body cell
// and nothing else — in every direction, including the away-from-camera column the cylinder used to steal.

import { test, expect, describe } from 'bun:test'
import { PerspectiveCamera, Vector3 } from 'three'

import { SENSHI_MALE_GLB_AVAILABLE } from '../test_helpers/glb_fixture.js'

import { cell_at_ndc } from './board_picking.js'

// MISSING-ARTIFACT (#117): board_entities.js unconditionally imports create_character_avatar, which
// static-imports the absent-by-design senshi_male.glb — see test_helpers/glb_fixture.js. Guarded dynamic
// import; entity_id_at_cell itself has no avatar dependency, but the module can't load without the asset.
const { entity_id_at_cell } = SENSHI_MALE_GLB_AVAILABLE ? await import('./board_entities.js') : {}

const CELL = 1.33 // DEFAULT_CELL_SIZE (D231)

// ── the LIVE fight camera (board_camera.js faux-iso: polar FROZEN 50° from vertical, FOV 42°) ──────────────
const POLAR = (50 * Math.PI) / 180
const FOV = 42
/** A faux-iso camera framing `target`, `dolly` metres out along azimuth 0 (camera to +X, looking down ~40°). */
function fight_cam(target, dolly = 18) {
  const cam = new PerspectiveCamera(FOV, 16 / 9, 0.1, 1000)
  const horizontal = Math.sin(POLAR) * dolly
  const vertical = Math.cos(POLAR) * dolly
  cam.position.set(target[0] + horizontal, target[1] + vertical, target[2])
  cam.up.set(0, 1, 0)
  cam.lookAt(new Vector3(target[0], target[1], target[2]))
  cam.updateMatrixWorld(true)
  cam.updateProjectionMatrix()
  return cam
}

/** Cell (cx,cy) → world floor centre, matching board.js cell_center_world at origin 0. */
const cell_world = (cx, cy) => [cx * CELL + CELL / 2, 0, cy * CELL + CELL / 2]

/** Project a WORLD point to NDC through the camera (the inverse of the plane pick's unproject). */
function to_ndc(cam, [x, y, z]) {
  const v = new Vector3(x, y, z).project(cam)
  return { x: v.x, y: v.y }
}

/** One placed entity stub: logical cell only — the pick needs NO avatar geometry any more (the point). */
const entity_on = (cx, cy) => ({ cell: { x: cx, y: cy } })

/** A 12×12 full-floor board descriptor at origin 0 (the plane the facade pick projects onto). */
const BOARD = {
  origin: { x: 0, y: 0, z: 0 },
  width: 12,
  height: 12,
  cell_size: CELL,
  mask: new Uint8Array(12 * 12), // CELL_FLOOR = 0 everywhere (board.js: 0 = walkable floor)
}

/** The facade's exact pick_entity composition (index.js): NDC → plane cell → the entity ON that cell. */
const hover = (entities, cam, cx, cy) =>
  entity_id_at_cell(entities, cell_at_ndc(to_ndc(cam, cell_world(cx, cy)), cam, BOARD))

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)('entity_id_at_cell — the pure cell lookup', () => {
  const entities = new Map([
    ['mob-0', entity_on(6, 6)],
    ['p-0', entity_on(3, 4)],
  ])
  test('the entity standing on the cell answers; an empty cell answers null', () => {
    expect(entity_id_at_cell(entities, { x: 6, y: 6 })).toBe('mob-0')
    expect(entity_id_at_cell(entities, { x: 3, y: 4 })).toBe('p-0')
    expect(entity_id_at_cell(entities, { x: 5, y: 6 })).toBeNull()
  })
  test('a null/undefined cell (off-board pick) answers null, never throws', () => {
    expect(entity_id_at_cell(entities, null)).toBeNull()
    expect(entity_id_at_cell(entities, undefined)).toBeNull()
  })
  test('an entity record without a cell yet (mid-spawn) never matches', () => {
    expect(entity_id_at_cell(new Map([['x', {}]]), { x: 0, y: 0 })).toBeNull()
  })
})

describe.skipIf(!SENSHI_MALE_GLB_AVAILABLE)(
  'D1 cell rule through the REAL fight-cam pick — a TALL mob steals no neighbouring ground',
  () => {
    const cam = fight_cam(cell_world(6, 6)) // camera on +X ⇒ "behind" (away from cam) = −X ⇒ cells (5,6), (4,6)
    const solo = new Map([['mob-0', entity_on(6, 6)]]) // body height is IRRELEVANT now — that is the fix

    test('cursor over the ground cells DIRECTLY BEHIND the mob hovers NO entity (the v30 report, dead)', () => {
      expect(hover(solo, cam, 5, 6)).toBeNull()
      expect(hover(solo, cam, 4, 6)).toBeNull()
    })

    test('the mob’s OWN cell hovers it — tooltips and mob aiming keep working', () => {
      expect(hover(solo, cam, 6, 6)).toBe('mob-0')
    })

    test('every other direction stays clean too (the 07-11 "3 blocks" class, still dead)', () => {
      for (const [cx, cy] of [
        [3, 6],
        [9, 6],
        [6, 3],
        [6, 9],
        [9, 9],
        [3, 3],
        [6, 4],
        [6, 5],
        [6, 7],
        [6, 8],
        [8, 6],
      ])
        expect(hover(solo, cam, cx, cy)).toBeNull()
    })

    test('two fighters: each answers exactly on its own cell, no nearest-along-ray stealing', () => {
      const two = new Map([
        ['mob-0', entity_on(6, 6)],
        ['mob-1', entity_on(5, 6)], // directly behind mob-0 from the camera — the old cylinder ambiguity
      ])
      expect(hover(two, cam, 6, 6)).toBe('mob-0')
      expect(hover(two, cam, 5, 6)).toBe('mob-1')
    })
  }
)
