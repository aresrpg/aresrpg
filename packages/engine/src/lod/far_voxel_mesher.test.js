// ENG-21 BLOCKY far-mesh tests (target: "voxel-look everywhere, detailed nearby"). Covers:
// (1) DISPATCH — build_far_mesh emits a 'voxel' mesh for L1/L2, a 'smooth' mesh for L3/L4;
// (2) FLAT SECTION — a constant-height section yields only flat top faces (up-normals), no risers/skirt;
// (3) RISERS — a stepped section grows vertical (horizontal-normal) wall faces between the steps;
// (4) PER-CELL FLAT COLOUR — every top TRIANGLE carries one uniform colour (no smooth corner blend);
// (5) SEAM/HEIGHT — top vertices sit at the cell's exact integer height (calm seam vs the near ring);
// (6) BYTES — voxel_mesh_bytes accounts every geometry array; colours are genuine (non-white/non-void).

import { test, expect, describe } from 'bun:test'

import { create_gen_context } from '../gen/column_gen.js'

import { build_voxel_mesh, build_terrace_mesh, voxel_mesh_bytes, FAR_VOXEL_MAX_LEVEL } from './far_voxel_mesher.js'
import { build_far_mesh } from './far_mesher.js'
import { CELLS_PER_SECTION, build_section, create_world_column_sampler } from './section_builder.js'

const N = CELLS_PER_SECTION

/**
 * Builds a Section-shaped object directly for exact golden control (mirrors far_mesher.test's helper).
 * @param {{height_fn:(cx:number,cz:number)=>number, block_fn?:(cx:number,cz:number)=>number, level?:number,
 *   sx?:number, sz?:number}} opts
 * @returns {import('./section_builder.js').Section}
 */
function make_section({ height_fn, block_fn = () => 3, level = 1, sx = 0, sz = 0 }) {
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
  const block_size = 1 << level
  return {
    level,
    sx,
    sz,
    block_size,
    origin_x: sx * N * block_size,
    origin_z: sz * N * block_size,
    height,
    block,
    min_height,
    sky_cells: 0,
    sky_height: null,
    sky_block: null,
  }
}

/** Iterates triangles, calling cb(i0,i1,i2) with vertex indices.
 *  @param {import('./far_voxel_mesher.js').VoxelMesh} m @param {(a:number,b:number,c:number)=>void} cb */
function for_each_tri(m, cb) {
  for (let i = 0; i < m.indices.length; i += 3) cb(m.indices[i], m.indices[i + 1], m.indices[i + 2])
}
/** A vertex's snorm8 normal is +Y (a top face) iff ny is the max axis.
 *  @param {import('./far_voxel_mesher.js').VoxelMesh} m @param {number} v */
const is_up = (m, v) => m.normals[v * 3 + 1] > 100 && m.normals[v * 3] === 0 && m.normals[v * 3 + 2] === 0

describe('build_voxel_mesh — blocky far geometry', () => {
  test('flat section → only flat top faces (all up-normals), N·N cells triangulated, no risers/skirt', () => {
    const m = build_voxel_mesh(make_section({ height_fn: () => 100 }))
    expect(m.kind).toBe('voxel')
    expect(m.min_height).toBe(100)
    // A flat, block-uniform section has NO height steps ⇒ no risers, and h===min ⇒ no skirt: pure tops.
    // Each of the N·N cells is one top quad = 4 verts / 6 indices.
    expect(m.positions.length / 3).toBe(N * N * 4)
    expect(m.indices.length).toBe(N * N * 6)
    for (let v = 0; v < m.positions.length / 3; v += 1) {
      expect(is_up(m, v)).toBe(true)
      expect(m.positions[v * 3 + 1]).toBe(100) // top sits at the cell's exact integer height
    }
  })

  test('a raised cell grows vertical RISER walls (horizontal normals) around it', () => {
    const flat = build_voxel_mesh(make_section({ height_fn: () => 100 }))
    const stepped = build_voxel_mesh(make_section({ height_fn: (cx, cz) => (cx === 10 && cz === 12 ? 110 : 100) }))
    // The step adds wall geometry beyond the flat baseline.
    expect(stepped.positions.length).toBeGreaterThan(flat.positions.length)
    // At least one vertex carries a purely-horizontal normal (a riser face).
    let horizontal = 0
    for (let v = 0; v < stepped.positions.length / 3; v += 1) {
      if (stepped.normals[v * 3 + 1] === 0 && (stepped.normals[v * 3] !== 0 || stepped.normals[v * 3 + 2] !== 0))
        horizontal += 1
    }
    expect(horizontal).toBeGreaterThan(0)
    // The raised cell's top sits at 110 (hard step, not an averaged ramp).
    let saw_110 = false
    for (let v = 0; v < stepped.positions.length / 3; v += 1)
      if (is_up(stepped, v) && stepped.positions[v * 3 + 1] === 110) saw_110 = true
    expect(saw_110).toBe(true)
  })

  test('per-cell FLAT colour: every top triangle carries one uniform RGB (no corner blend)', () => {
    // Varied heights (forces risers) but keeps top faces present; every top triangle must be single-colour.
    const m = build_voxel_mesh(make_section({ height_fn: (cx) => 100 + (cx % 3) }))
    let checked = 0
    for_each_tri(m, (a, b, c) => {
      if (!(is_up(m, a) && is_up(m, b) && is_up(m, c))) return
      for (const k of [0, 1, 2]) {
        expect(m.colors[b * 3 + k]).toBe(m.colors[a * 3 + k])
        expect(m.colors[c * 3 + k]).toBe(m.colors[a * 3 + k])
      }
      checked += 1
    })
    expect(checked).toBeGreaterThan(0)
  })

  test('border skirt drops to min_height when the border cell stands above it (crack cover)', () => {
    // Left column raised so its border cells stand above the section min ⇒ a skirt wall to min_height.
    const m = build_voxel_mesh(make_section({ height_fn: (cx) => (cx === 0 ? 120 : 100) }))
    expect(m.min_height).toBe(100)
    // Some vertex sits at the skirt floor (min_height) with a horizontal normal (a wall vertex).
    let floor_wall = 0
    for (let v = 0; v < m.positions.length / 3; v += 1) {
      if (
        m.positions[v * 3 + 1] === 100 &&
        m.normals[v * 3 + 1] === 0 &&
        (m.normals[v * 3] !== 0 || m.normals[v * 3 + 2] !== 0)
      )
        floor_wall += 1
    }
    expect(floor_wall).toBeGreaterThan(0)
  })

  test('colours are genuine (non-white, non-void) for a grass section', () => {
    const m = build_voxel_mesh(make_section({ height_fn: () => 100, block_fn: () => 3 }))
    let white = 0
    let colored = 0
    for (let v = 0; v < m.colors.length / 3; v += 1) {
      const r = m.colors[v * 3]
      const g = m.colors[v * 3 + 1]
      const b = m.colors[v * 3 + 2]
      if (r > 240 && g > 240 && b > 240) white += 1
      if (r + g + b > 30) colored += 1
    }
    expect(colored).toBe(m.colors.length / 3) // every vertex carries real colour
    expect(white).toBe(0)
  })

  test('voxel_mesh_bytes accounts every geometry array', () => {
    const m = build_voxel_mesh(make_section({ height_fn: (cx) => 100 + (cx % 4) }))
    expect(voxel_mesh_bytes(m)).toBe(
      m.positions.byteLength + m.normals.byteLength + m.colors.byteLength + m.indices.byteLength
    )
  })
})

describe('build_far_mesh dispatch (progressive voxel doubling; ?farvoxel oracle override)', () => {
  test('[S-27] DEFAULT ceiling 2 ⇒ L1/L2 mesh REAL blocky voxels (2×2 / 4×4), L3/L4 stay SMOOTH', () => {
    expect(FAR_VOXEL_MAX_LEVEL).toBe(2)
    for (const level of [1, 2]) {
      expect(build_far_mesh(make_section({ height_fn: () => 100, level })).kind).toBe('voxel')
    }
    for (const level of [3, 4]) {
      expect(build_far_mesh(make_section({ height_fn: () => 100, level })).kind).toBe('smooth')
    }
  })

  test('explicit voxel_max override (the ?farvoxel A/B oracle) ⇒ level ≤ N meshes real blocky voxels', () => {
    expect(build_far_mesh(make_section({ height_fn: () => 100, level: 1 }), 2).kind).toBe('voxel')
    expect(build_far_mesh(make_section({ height_fn: () => 100, level: 2 }), 2).kind).toBe('voxel')
    expect(build_far_mesh(make_section({ height_fn: () => 100, level: 3 }), 2).kind).toBe('smooth')
  })

  test('a real generated L1 section meshes blocky under the oracle override (genuine colours + risers)', () => {
    const sampler = create_world_column_sampler(create_gen_context('aresrpg'))
    const mesh = build_far_mesh(build_section(sampler, 1, 0, 0), 2)
    expect(mesh.kind).toBe('voxel')
    const m = /** @type {import('./far_voxel_mesher.js').VoxelMesh} */ (mesh)
    expect(m.indices.length).toBeGreaterThan(N * N * 6) // tops + at least some risers over real terrain
    let colored = 0
    for (let v = 0; v < m.colors.length / 3; v += 1)
      if (m.colors[v * 3] + m.colors[v * 3 + 1] + m.colors[v * 3 + 2] > 30) colored += 1
    expect(colored).toBe(m.colors.length / 3)
  })
})

describe('build_terrace_mesh — contour-terrace far band (S-27 round 2: planes with layers)', () => {
  test('flat uniform section greedy-merges to ONE plane (4 verts / 6 indices) at the quantized layer', () => {
    const m = build_terrace_mesh(make_section({ height_fn: () => 101 }), 2)
    expect(m.kind).toBe('voxel')
    expect(/** @type {*} */ (m).terraced).toBe(true)
    expect(m.positions.length / 3).toBe(4)
    expect(m.indices.length).toBe(6)
    for (let v = 0; v < 4; v += 1) expect(m.positions[v * 3 + 1]).toBe(102) // round(101/2)·2
  })
  test('every top sits on a layer multiple; a slope grows riser walls between contour bands', () => {
    const m = build_terrace_mesh(make_section({ height_fn: (cx) => 100 + cx }), 2)
    let tops = 0
    let walls = 0
    for (let v = 0; v < m.positions.length / 3; v += 1) {
      if (is_up(m, v)) {
        tops += 1
        expect(m.positions[v * 3 + 1] % 2).toBe(0)
      }
      if (m.normals[v * 3 + 1] === 0 && (m.normals[v * 3] !== 0 || m.normals[v * 3 + 2] !== 0)) walls += 1
    }
    expect(tops).toBeGreaterThan(0)
    expect(walls).toBeGreaterThan(0)
  })
  test('XZ merge SHRINKS geometry hard vs the per-cell voxel mesh (axis-aligned contour bands)', () => {
    const sec = make_section({ height_fn: (cx) => 100 + Math.floor(cx / 8) * 4 })
    const terrace = build_terrace_mesh(sec, 2)
    const per_cell = build_voxel_mesh(sec)
    expect(terrace.positions.length).toBeLessThan(per_cell.positions.length / 8)
  })
  test('block-id boundaries never merge: every top triangle stays single-colour', () => {
    const m = build_terrace_mesh(make_section({ height_fn: () => 100, block_fn: (cx) => (cx < 16 ? 3 : 5) }), 2)
    let checked = 0
    for_each_tri(m, (a, b, c) => {
      if (!(is_up(m, a) && is_up(m, b) && is_up(m, c))) return
      for (const k of [0, 1, 2]) {
        expect(m.colors[b * 3 + k]).toBe(m.colors[a * 3 + k])
        expect(m.colors[c * 3 + k]).toBe(m.colors[a * 3 + k])
      }
      checked += 1
    })
    expect(checked).toBeGreaterThanOrEqual(2) // one rect per block id
  })
  test('voxel_mesh_bytes accounts the terrace arrays', () => {
    const m = build_terrace_mesh(make_section({ height_fn: (cx) => 100 + (cx % 8) }), 2)
    expect(voxel_mesh_bytes(m)).toBe(
      m.positions.byteLength + m.normals.byteLength + m.colors.byteLength + m.indices.byteLength
    )
  })
  test('dispatch: voxel_max 2 + terrace_max 3 ⇒ L2 real voxel, L3 terraced, L4 smooth; default = today', () => {
    expect(build_far_mesh(make_section({ height_fn: () => 100, level: 2 }), 2, 3).kind).toBe('voxel')
    const l3 = build_far_mesh(make_section({ height_fn: () => 100, level: 3 }), 2, 3)
    expect(l3.kind).toBe('voxel')
    expect(/** @type {*} */ (l3).terraced).toBe(true)
    expect(build_far_mesh(make_section({ height_fn: () => 100, level: 4 }), 2, 3).kind).toBe('smooth')
    expect(build_far_mesh(make_section({ height_fn: () => 100, level: 3 }), 2).kind).toBe('smooth') // no flag ⇒ unchanged
  })
})
