// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ENG-16 Phase B — board geometry invariants (three.js core instantiates under bun; no WebGPU here).
//
// Locks: per-class instance counts match the mask, the single cell→world mapper's centering, and the
// same-args cheap-no-op signature that guarantees a reconcile-storm rebuild is skipped.

import { test, expect, describe } from 'bun:test'
import { BackSide } from 'three'

import { build_board_geometry, CELL_OBSTACLE, CELL_HOLE, mask_index } from '../../src/tactical/board.js'

/** A 6×5 board with one obstacle + two holes carved out (a non-rectangular playable shape). */
function fixture() {
  const width = 6
  const height = 5
  const mask = new Uint8Array(width * height)
  mask[mask_index(1, 1, width)] = CELL_OBSTACLE
  mask[mask_index(2, 2, width)] = CELL_HOLE
  mask[mask_index(3, 2, width)] = CELL_HOLE
  return { origin: { x: 0, y: 10, z: 0 }, width, height, mask, cell_size: 2 }
}

describe('build_board_geometry — substrate classes match the mask', () => {
  test('[D264b] slab covers floor+obstacle cells; prop instance counts match; holes are openings', () => {
    const p = fixture()
    const g = build_board_geometry(p)
    const by_name = Object.fromEntries(g.group.children.map((c) => [c.name, /** @type {any} */ (c)]))
    // DEFAULT obstacle = a clean half-height block InstancedMesh (retro read); one per cell.
    expect(by_name.board_obstacle.count).toBe(1)
    expect(by_name.board_hole.count).toBe(2)
    // [D264b owner reference: "no space"] the floor is ONE contiguous slab Mesh (not instanced tiles);
    // its top covers every floor + obstacle cell (props sit ON the paving), holes stay open.
    expect(by_name.board_floor.isMesh).toBe(true)
    expect(by_name.board_floor.userData.top_cell_count).toBe(6 * 5 - 2) // all cells minus the 2 holes
    // [D231] The dark half-border edge curbs were unnecessary and are DELETED — permanent count-0.
    expect(by_name.board_edge.count).toBe(0)
    g.dispose()
  })

  test("[owner] obstacle_style:'props' opts into the merged archetype Mesh (later dungeon theming)", () => {
    const g = build_board_geometry({ ...fixture(), obstacle_style: 'props' })
    const by_name = Object.fromEntries(g.group.children.map((c) => [c.name, /** @type {any} */ (c)]))
    // the opt-in path swaps the half-block InstancedMesh for a merged multi-voxel prop Mesh (real vertices).
    expect(by_name.board_obstacle.isMesh).toBe(true)
    expect(by_name.board_obstacle.userData.obstacle_count).toBe(1)
    expect(by_name.board_obstacle.geometry.getAttribute('position').count).toBeGreaterThan(0)
    g.dispose()
  })
})

// [live-QA] The board decoration must render two hard reads. These lock the
// PRESENTATION mapping (chain cell byte → geometry) so a future refactor can't silently regress it:
//   spec 4 — an obstacle is ONE clean HALF-height block (a simple readable mass), NEVER a multi-voxel rubble
//            pile (that stays behind obstacle_style:'props' for later theming).
//   spec 3 — a hole is a DEEP DARK shaft (dark walls/floor, seen from INSIDE via BackSide), never a green fill.
// The world-truth invariant (holes exactly on hole cells, blocks exactly on obstacle cells) rides on the same
// fixture: a crafted grid, zero drift between the chain bytes and the emitted decor.
describe('[specs 3+4] decor mapping — dark holes + single half-blocks, zero drift', () => {
  const by = (/** @type {any} */ g) => Object.fromEntries(g.group.children.map((/** @type {any} */ c) => [c.name, c]))
  const bbox = (/** @type {any} */ mesh) => {
    mesh.geometry.computeBoundingBox()
    const b = mesh.geometry.boundingBox
    return { hx: b.max.x - b.min.x, hy: b.max.y - b.min.y, hz: b.max.z - b.min.z }
  }

  test('spec 4 — DEFAULT obstacle is ONE clean block (not a multi-voxel prop), bevelled per design ruling 2026-07-20', () => {
    const p = fixture() // cell_size = 2 → OBSTACLE_HEIGHT_RATIO 0.58 ⇒ a 1.16 m tall block
    const g = build_board_geometry(p)
    const obs = by(g).board_obstacle
    // [design ruling 2026-07-20: soften the edge of these cubes] a RoundedBoxGeometry has more verts than a
    // sharp box's 24 (the bevel rings) — still ONE cheap primitive shared by every instance, nowhere
    // near a multi-voxel prop pile's per-instance vertex budget.
    expect(obs.geometry.getAttribute('position').count).toBeGreaterThan(24)
    // the actual softening proof: a sharp box's normals are all purely axis-aligned (one component ±1,
    // the other two 0 ⇒ max-abs-component === 1 for EVERY vertex). A bevelled corner's normal is
    // diagonal (max-abs-component drops toward 1/√3≈0.577 at the true corner). If this regresses to a
    // plain box, every vertex reads max-abs-component === 1 and the assertion below goes red.
    const normal = obs.geometry.getAttribute('normal')
    let min_max_component = 1
    for (let v = 0; v < normal.count; v += 1) {
      const m = Math.max(Math.abs(normal.getX(v)), Math.abs(normal.getY(v)), Math.abs(normal.getZ(v)))
      min_max_component = Math.min(min_max_component, m)
    }
    expect(min_max_component).toBeLessThan(0.9) // a genuinely diagonal (bevelled-corner) normal exists
    const dim = bbox(obs)
    // OBSTACLE_HEIGHT_RATIO 0.58 (pick "A", was a half-height 0.5) — chunkier than half, still
    // never full-height and never a spike. The bevel cuts corners INWARD only — it never shrinks the
    // overall bounding box (a flat-face-centre vertex still lands exactly on the un-bevelled extent).
    expect(dim.hy).toBeCloseTo(p.cell_size * 0.58, 5)
    expect(dim.hy).toBeLessThan(p.cell_size) // not a full-height wall
    // footprint is inset (a paving margin shows around the base), square, and inside the cell (never spills — D167).
    expect(dim.hx).toBeCloseTo(dim.hz, 5)
    expect(dim.hx).toBeLessThan(p.cell_size)
    expect(dim.hx).toBeGreaterThan(p.cell_size * 0.7)
    g.dispose()
  })

  test('spec 3 — a hole is a DEEP DARK shaft (BackSide, dark colors, never green fill)', () => {
    const p = fixture()
    const g = build_board_geometry(p)
    const hole = by(g).board_hole
    // rendered from the INSIDE so the camera sees down the recess and the closed far walls/bottom occlude the
    // green ground beneath — a FrontSide box would show its lid (the exact green-square defect this fixes).
    expect(hole.material.side).toBe(BackSide)
    // a DEEP shaft (a few blocks / ~6× the paving thickness), not a shallow lid whose top face read as a green
    // square. HOLE_DEPTH is absolute metres, so compare to the obstacle half-block: the void drops MUCH deeper
    // than the block rises — the eye reads "pit", not "tile".
    const dim = bbox(hole)
    const block_h = bbox(by(g).board_obstacle).hy
    expect(dim.hy).toBeGreaterThan(1.0) // > a metre of recess — a real shaft, not a 0.3 m paving-lid
    expect(dim.hy).toBeGreaterThan(block_h) // the pit sinks deeper than the half-block stands proud
    // every baked wall/floor color is DARK and NOT green-dominant (the void reads black, never a grass square).
    const col = hole.geometry.getAttribute('color')
    let maxLum = 0
    let green_dominant = 0
    for (let v = 0; v < col.count; v += 1) {
      const r = col.getX(v)
      const gg = col.getY(v)
      const b = col.getZ(v)
      maxLum = Math.max(maxLum, 0.299 * r + 0.587 * gg + 0.114 * b)
      if (gg > r + 0.03 && gg > b + 0.03) green_dominant += 1 // green clearly the top channel = a "green fill"
    }
    expect(maxLum).toBeLessThan(0.12) // even the brightest rim texel is dark (a shadowed-stone void, not lit grass)
    expect(green_dominant).toBe(0) // no texel reads green — kills the "filled with green blocks" defect
    g.dispose()
  })

  test('zero drift — every block sits on an obstacle cell, every shaft on a hole cell (crafted grid)', () => {
    // a crafted 5×4 grid: obstacles at (1,1)+(3,2), holes at (2,0)+(2,3). The emitted decor must land EXACTLY on
    // those cells (playable-cell truth never diverges from the chain mask) — read back each instance's world XZ.
    const width = 5
    const height = 4
    const cell_size = 2
    const origin = { x: 0, y: 0, z: 0 }
    const mask = new Uint8Array(width * height)
    const obstacle_cells = [
      { x: 1, y: 1 },
      { x: 3, y: 2 },
    ]
    const hole_cells = [
      { x: 2, y: 0 },
      { x: 2, y: 3 },
    ]
    for (const c of obstacle_cells) mask[mask_index(c.x, c.y, width)] = CELL_OBSTACLE
    for (const c of hole_cells) mask[mask_index(c.x, c.y, width)] = CELL_HOLE
    const g = build_board_geometry({ origin, width, height, mask, cell_size })
    const center_xz = (/** @type {{x:number,y:number}} */ c) => [
      origin.x + (c.x + 0.5) * cell_size,
      origin.z + (c.y + 0.5) * cell_size,
    ]
    const read_xz = (/** @type {any} */ mesh, /** @type {number} */ n) => {
      const out = []
      const m = /** @type {any} */ (mesh)
      for (let i = 0; i < n; i += 1) {
        const e = m.instanceMatrix.array
        out.push([e[i * 16 + 12], e[i * 16 + 14]]) // translation x,z from the instance matrix
      }
      return out.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    }
    const obs = by(g).board_obstacle
    const hole = by(g).board_hole
    expect(obs.count).toBe(2)
    expect(hole.count).toBe(2)
    expect(read_xz(obs, 2)).toEqual(obstacle_cells.map(center_xz).sort((a, b) => a[0] - b[0] || a[1] - b[1]))
    expect(read_xz(hole, 2)).toEqual(hole_cells.map(center_xz).sort((a, b) => a[0] - b[0] || a[1] - b[1]))
    g.dispose()
  })
})

describe('cell_center_world — the single mapper', () => {
  test('cell (0,0) center = origin + half a cell; +x east, +y north (world +Z)', () => {
    const g = build_board_geometry(fixture())
    expect(g.cell_center_world(0, 0)).toEqual([1, 10, 1]) // origin (0,10,0) + (0.5·2, 0, 0.5·2)
    expect(g.cell_center_world(1, 0)).toEqual([3, 10, 1]) // +x → +world X
    expect(g.cell_center_world(0, 1)).toEqual([1, 10, 3]) // +y → +world Z (north)
    g.dispose()
  })

  // REGRESSION (a mob rendered OFF the visible board): the fight-entity projection MUST consume the
  // board's REAL grid dims — a stale hardcoded 10×10 fallback scatters every high-index cell (x≥10 or y≥10)
  // off the board (and its on-chain twin then rejects the click, apply_move EIllegalMove/104). The mapper is
  // pure (origin + (cell+0.5)·cell_size, no width/height in the formula), so ANY real width projects on-board —
  // this locks that the projection never re-introduces a fixed dimension. A NON-square, NON-10 board (13×9).
  test('a NON-10 board (13×9) maps its every corner cell on-board — no hardcoded-10 scatter', () => {
    const width = 13
    const height = 9
    const g = build_board_geometry({
      origin: { x: 100, y: 40, z: 200 },
      width,
      height,
      mask: new Uint8Array(width * height),
      cell_size: 1.33,
    })
    const cs = 1.33
    const at = (/** @type {number} */ x, /** @type {number} */ y) =>
      /** @type {[number, number, number]} */ ([100 + (x + 0.5) * cs, 40, 200 + (y + 0.5) * cs])
    expect(g.cell_center_world(0, 0)).toEqual(at(0, 0)) // min corner
    expect(g.cell_center_world(width - 1, 0)).toEqual(at(12, 0)) // far-EAST corner: x=12 (≥10 — the old fallback dropped it)
    expect(g.cell_center_world(0, height - 1)).toEqual(at(0, 8)) // far-NORTH corner
    expect(g.cell_center_world(width - 1, height - 1)).toEqual(at(12, 8)) // last cell — both indices past 10
    // the cell that a 10×10 fallback would push OFF the east edge lands on THIS board's paving, not in space.
    const [ex] = g.cell_center_world(12, 4)
    expect(ex).toBeGreaterThan(100 + 10 * cs) // east of where a 10-wide board would end
    expect(g.is_walkable(12, 8)).toBe(true) // and it's a real, standable cell on the 13×9 shape
    g.dispose()
  })
})

describe('walkability from the mask (D75 — holes/obstacles never walkable)', () => {
  test('only in-bounds floor cells are walkable', () => {
    const g = build_board_geometry(fixture())
    expect(g.is_walkable(0, 0)).toBe(true)
    expect(g.is_walkable(1, 1)).toBe(false) // obstacle
    expect(g.is_walkable(2, 2)).toBe(false) // hole
    expect(g.is_walkable(-1, 0)).toBe(false) // out of bounds
    expect(g.is_walkable(6, 0)).toBe(false)
    g.dispose()
  })
})

describe('same_args — reconcile-storm cheap no-op', () => {
  test('identical params match; any change (origin/size/mask/cell_size) differs', () => {
    const p = fixture()
    const g = build_board_geometry(p)
    expect(g.same_args({ ...p, mask: p.mask.slice() })).toBe(true) // value-identical mask
    expect(g.same_args({ ...p, origin: { x: 1, y: 10, z: 0 } })).toBe(false)
    expect(g.same_args({ ...p, cell_size: 3 })).toBe(false)
    expect(g.same_args({ ...p, width: 7 })).toBe(false)
    const changed = p.mask.slice()
    changed[0] = CELL_OBSTACLE
    expect(g.same_args({ ...p, mask: changed })).toBe(false)
    g.dispose()
  })
})
