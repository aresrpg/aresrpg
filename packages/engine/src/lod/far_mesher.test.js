// NG-LOD SMOOTH far-mesh tests (design pivot: continuous heightfield, not box-columns). Covers:
// (1) CORNER GRID — a section's 32×32 cells become a 33×33 corner grid; each corner height is the
// AVERAGE of the ≤4 touching cells (interior corners see 4, edge corners 2, section corners 1);
// (2) FLAT SECTION — a constant-height section yields a flat grid at that height, min_height = it;
// (3) INTERIOR RAISE — one raised cell lifts exactly its 4 shared corners by the averaged amount;
// (4) COLOR — corner color is the blended map color of touching cells; (5) SKY LAYER — present only
// when the section has sky cells, and its corners participate only over the island footprint.

import { test, expect, describe } from 'bun:test'

import { create_gen_context } from '../gen/column_gen.js'

import { build_far_mesh as build_far_mesh_any, far_mesh_bytes, CORNERS_PER_EDGE, SKY_SLAB_DEPTH } from './far_mesher.js'
import { CELLS_PER_SECTION, LOD_MAX_LEVEL, build_section, create_world_column_sampler } from './section_builder.js'
import { get_map_color } from './colors.js'

// Every test in THIS file exercises the SMOOTH corner-grid path (all sections are LOD_MAX_LEVEL=4, past
// FAR_VOXEL_MAX_LEVEL). build_far_mesh now returns FarMesh|VoxelMesh; narrow to FarMesh here so the
// corner-grid assertions (.ground/.sky) type-check. The blocky path has its own suite (far_voxel_mesher.test.js).
/** @param {import('./section_builder.js').Section} s @returns {import('./far_mesher.js').FarMesh} */
const build_far_mesh = (s) => /** @type {import('./far_mesher.js').FarMesh} */ (build_far_mesh_any(s))

const N = CELLS_PER_SECTION
const C = CORNERS_PER_EDGE

/**
 * Builds a Section-shaped object directly for exact golden control.
 * @param {{height_fn:(cx:number,cz:number)=>number, block_fn?:(cx:number,cz:number)=>number,
 *   sky_fn?:((cx:number,cz:number)=>number)|null, level?:number}} opts
 * @returns {import('./section_builder.js').Section}
 */
function make_section({ height_fn, block_fn = () => 3, sky_fn = null, level = LOD_MAX_LEVEL }) {
  const cell_count = N * N
  const height = new Uint16Array(cell_count)
  const block = new Uint16Array(cell_count)
  let min_height = 0xffff
  for (let cz = 0; cz < N; cz += 1) {
    for (let cx = 0; cx < N; cx += 1) {
      const ci = cz * N + cx
      const h = height_fn(cx, cz)
      height[ci] = h
      block[ci] = block_fn(cx, cz)
      if (h < min_height) min_height = h
    }
  }
  let sky_height = null
  let sky_block = null
  let sky_cells = 0
  if (sky_fn) {
    sky_height = new Uint16Array(cell_count)
    sky_block = new Uint16Array(cell_count)
    for (let cz = 0; cz < N; cz += 1) {
      for (let cx = 0; cx < N; cx += 1) {
        const ci = cz * N + cx
        const h = sky_fn(cx, cz)
        if (h > 0) {
          sky_height[ci] = h
          sky_block[ci] = 8
          sky_cells += 1
        }
      }
    }
  }
  const block_size = 1 << level
  return {
    level,
    sx: 0,
    sz: 0,
    block_size,
    origin_x: 0,
    origin_z: 0,
    height,
    block,
    min_height,
    sky_cells,
    sky_height,
    sky_block,
  }
}

/** Corner grid index. @param {number} rx @param {number} rz */
const ck = (rx, rz) => rz * C + rx

describe('smooth ground layer', () => {
  test('corner grid is 33×33 and every ground corner participates', () => {
    const mesh = build_far_mesh(make_section({ height_fn: () => 100 }))
    expect(mesh.ground.corner_h.length).toBe(C * C)
    expect(mesh.ground.corner_mask.every((m) => m === 1)).toBe(true)
    expect(mesh.sky).toBeNull()
  })

  test('flat section → flat corner grid at that height, min_height = it', () => {
    const mesh = build_far_mesh(make_section({ height_fn: () => 100 }))
    for (let k = 0; k < C * C; k += 1) expect(mesh.ground.corner_h[k]).toBe(100)
    expect(mesh.ground.min_height).toBe(100)
  })

  test('interior raise: a corner height is the AVERAGE of its touching cells', () => {
    // One interior cell (10,12) raised to 110, all else 100. The corner at (11,13) is shared by 4
    // cells: (10,12)=110 + (11,12)=100 + (10,13)=100 + (11,13)=100 → avg 102.5. A corner touching
    // only the raised cell doesn't exist here (it's interior), but the 4 corners of the raised cell
    // each see it once among their 4 → each = (110+100+100+100)/4 = 102.5.
    const mesh = build_far_mesh(make_section({ height_fn: (cx, cz) => (cx === 10 && cz === 12 ? 110 : 100) }))
    // The 4 corners of cell (10,12): (10,12),(11,12),(10,13),(11,13).
    for (const [rx, rz] of [
      [10, 12],
      [11, 12],
      [10, 13],
      [11, 13],
    ]) {
      expect(mesh.ground.corner_h[ck(rx, rz)]).toBeCloseTo(102.5, 5)
    }
    // A corner far from the raise stays 100.
    expect(mesh.ground.corner_h[ck(2, 2)]).toBe(100)
    // min stays 100 (unraised corners); the raise only lifts a local patch.
    expect(mesh.ground.min_height).toBe(100)
  })

  test('section-corner sees exactly ONE cell; edge-corner sees TWO', () => {
    // Ramp so each cell has a distinct height = cx (independent of cz) → averaging is analyzable.
    const mesh = build_far_mesh(make_section({ height_fn: (cx) => 100 + cx }))
    // Corner (0,0) touches only cell (0,0) → height 100+0 = 100.
    expect(mesh.ground.corner_h[ck(0, 0)]).toBe(100)
    // Corner (1,0) touches cells (0,0)=100 and (1,0)=101 → avg 100.5.
    expect(mesh.ground.corner_h[ck(1, 0)]).toBeCloseTo(100.5, 5)
    // Interior corner (5,5) touches cells (4,4)(5,4)(4,5)(5,5) heights 104,105,104,105 → avg 104.5.
    expect(mesh.ground.corner_h[ck(5, 5)]).toBeCloseTo(104.5, 5)
  })

  test('smooth normals: a flat section has straight-up normals', () => {
    const mesh = build_far_mesh(make_section({ height_fn: () => 100 }))
    // Every participating corner normal ≈ (0,1,0).
    for (let k = 0; k < C * C; k += 1) {
      expect(mesh.ground.corner_n[k * 3]).toBeCloseTo(0, 5)
      expect(mesh.ground.corner_n[k * 3 + 1]).toBeCloseTo(1, 5)
      expect(mesh.ground.corner_n[k * 3 + 2]).toBeCloseTo(0, 5)
    }
  })

  test('smooth normals: a slope tilts the normal against the gradient', () => {
    // Height rises with cx → surface tilts up toward +x, so the normal leans toward −x (nx < 0).
    const mesh = build_far_mesh(make_section({ height_fn: (cx) => 100 + cx }))
    const k = 16 * C + 16 // an interior corner
    expect(mesh.ground.corner_n[k * 3]).toBeLessThan(0) // leans −x (against the +x uphill)
    expect(mesh.ground.corner_n[k * 3 + 1]).toBeGreaterThan(0) // still mostly up
    expect(Math.abs(mesh.ground.corner_n[k * 3 + 2])).toBeCloseTo(0, 5) // no z gradient
  })

  test('corner color is the blended map color of touching cells (coarse level, un-tinted)', () => {
    // A COARSE section (default level LOD_MAX_LEVEL=4, past FAR_TINT_MAX_LEVEL) carries the raw flat map
    // colour: uniform block id 3 → every corner is exactly get_map_color(3).
    const [r, g, b] = get_map_color(3)
    const mesh = build_far_mesh(make_section({ height_fn: () => 100, block_fn: () => 3, level: 4 }))
    expect(mesh.ground.corner_c[0]).toBe(r)
    expect(mesh.ground.corner_c[1]).toBe(g)
    expect(mesh.ground.corner_c[2]).toBe(b)
  })
})

describe('color integrity (no uncolored / white sections unless snow)', () => {
  test('corner colors are never pure-white for a non-snow block', () => {
    // block id 3 (grass) → a green map color, never white. Every corner must carry it (no white
    // fallback / missing color → the reported "uncolored white polygons").
    const mesh = build_far_mesh(make_section({ height_fn: () => 100, block_fn: () => 3 }))
    for (let k = 0; k < C * C; k += 1) {
      const r = mesh.ground.corner_c[k * 3]
      const g = mesh.ground.corner_c[k * 3 + 1]
      const b = mesh.ground.corner_c[k * 3 + 2]
      const pure_white = r > 240 && g > 240 && b > 240
      expect(pure_white).toBe(false)
    }
  })

  test('a real generated section carries genuine (non-white) colors', () => {
    // Build over the world; assert the corner colors are not a uniform white sheet (a wiring miss would
    // leave the color attribute white/black for whole sections).
    const ctx = create_gen_context('aresrpg')
    const sampler = create_world_column_sampler(ctx)
    const mesh = build_far_mesh(build_section(sampler, 4, 0, 0))
    let white = 0
    let colored = 0
    for (let k = 0; k < C * C; k += 1) {
      if (!mesh.ground.corner_mask[k]) continue
      const r = mesh.ground.corner_c[k * 3]
      const g = mesh.ground.corner_c[k * 3 + 1]
      const b = mesh.ground.corner_c[k * 3 + 2]
      if (r > 240 && g > 240 && b > 240) white += 1
      if (r + g + b > 30) colored += 1
    }
    expect(colored).toBeGreaterThan(500) // the section is genuinely colored, not a black/white void
    expect(white).toBeLessThan(colored * 0.5) // not a white sheet (a little snow is fine)
  })
})

describe('sky layer — DISABLED for release (2026-07-05, the final white-ghost root)', () => {
  // The far sky-island layer rendered as huge white hazed voxel-ghost domes/arcs + skirt curtains
  // around the camera (the reported "box following me… static circle halo" family). It is disabled at
  // the mesh level until it can be made beautiful — these tests PIN the disabled contract so a silent
  // re-enable can't ship unreviewed. (SKY_SLAB_DEPTH is retained for the eventual return.)
  test('no sky layer when the section has no sky cells', () => {
    expect(build_far_mesh(make_section({ height_fn: () => 100 })).sky).toBeNull()
  })

  test('sky stays NULL even when the section carries island cells (release kill-switch)', () => {
    const mesh = build_far_mesh(
      make_section({
        height_fn: () => 100,
        sky_fn: (cx, cz) => (cx >= 10 && cx <= 13 && cz >= 10 && cz <= 13 ? (cx < 12 ? 330 : 360) : 0),
      })
    )
    expect(mesh.sky).toBeNull()
    void SKY_SLAB_DEPTH // retained constant — consumed again when the layer returns
    void ck
  })
})

describe('far_mesh_bytes', () => {
  test('accounts the ground layer only (sky disabled)', () => {
    const ground_only = build_far_mesh(make_section({ height_fn: () => 100 }))
    const one_layer = C * C * 4 + C * C * 3 + C * C * 3 * 4 + C * C // h(f32) + rgb(u8) + n(f32×3) + mask(u8)
    expect(far_mesh_bytes(ground_only)).toBe(one_layer)
    const with_sky_cells = build_far_mesh(
      make_section({
        height_fn: () => 100,
        sky_fn: (cx, cz) => (cx === 5 && cz === 5 ? 330 : 0),
      })
    )
    expect(far_mesh_bytes(with_sky_cells)).toBe(one_layer) // island cells no longer add a layer
  })
})
