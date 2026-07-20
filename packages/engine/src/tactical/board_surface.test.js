// Board surface invariants — the reference-frame laws, pinned:
//   • the slab is CONTIGUOUS (adjacent cells share exact corner coordinates — zero spacing),
//   • the grid reads through BAKED darker seams (texture, not geometry gaps),
//   • per-tile tonal variety exists (procedural, deterministic),
//   • the outline gets darker trim texels + side skirts where the slab meets off-slab space.

import { test, expect, describe } from 'bun:test'

import { bake_board_surface, build_slab_geometry, board_seed } from './board_surface.js'
import { CELL_OBSTACLE, CELL_HOLE, CELL_VOID } from './board.js'

const FLAT = () => 0

/** 6×5 all-floor mask with one obstacle + one hole + one void corner. */
function fixture() {
  const width = 6
  const height = 5
  const mask = new Uint8Array(width * height)
  mask[1 + 1 * width] = CELL_OBSTACLE
  mask[2 + 2 * width] = CELL_HOLE
  mask[5 + 0 * width] = CELL_VOID
  return { mask, width, height }
}

/** Luminance-ish sum of the texel at (x,y). @param {import('three').DataTexture} t @param {number} x @param {number} y */
function texel(t, x, y) {
  const d = /** @type {Uint8Array} */ (t.image.data)
  const o = (x + y * t.image.width) * 4
  return d[o] + d[o + 1] + d[o + 2]
}

describe('bake_board_surface — the procedural paving sheet', () => {
  test('deterministic: two bakes of the same board are byte-identical', () => {
    const f = fixture()
    const a = bake_board_surface(f)
    const b = bake_board_surface(f)
    expect(
      Buffer.from(/** @type {Uint8Array} */ (a.image.data)).equals(
        Buffer.from(/** @type {Uint8Array} */ (b.image.data))
      )
    ).toBe(true)
    a.dispose()
    b.dispose()
  })

  test('seams are darker than the adjacent tile interiors (the grid reads WITHOUT gaps)', () => {
    const f = fixture()
    const t = bake_board_surface(f)
    const px = t.image.width / f.width
    // the seam between cells (0,0) and (1,0) vs both tile centres — sample mid-edge.
    const seam = texel(t, px, px / 2)
    const left = texel(t, px / 2, px / 2)
    const right = texel(t, px + px / 2, px / 2)
    expect(seam).toBeLessThan(left)
    expect(seam).toBeLessThan(right)
    t.dispose()
  })

  test('per-tile tonal variety: not all tile centres share one tone (no flat checker)', () => {
    const f = fixture()
    const t = bake_board_surface(f)
    const px = t.image.width / f.width
    const tones = new Set()
    for (let cy = 0; cy < f.height; cy += 1)
      for (let cx = 0; cx < 5; cx += 1) tones.add(texel(t, cx * px + px / 2, cy * px + px / 2))
    expect(tones.size).toBeGreaterThan(4) // cream/beige/gray patches + grain — never uniform
    t.dispose()
  })

  test('outline trim: the slab edge bordering VOID is darker than the tile centre', () => {
    const f = fixture() // (5,0) is void → cell (4,0)'s east edge gets the trim band
    const t = bake_board_surface(f)
    const px = t.image.width / f.width
    const edge = texel(t, 5 * px - 2, px / 2) // outer trim texels of cell (4,0)
    const centre = texel(t, 4 * px + px / 2, px / 2)
    expect(edge).toBeLessThan(centre)
    t.dispose()
  })

  test('board_seed folds mask content — a different mask bakes a different sheet', () => {
    const f = fixture()
    const other = { ...f, mask: new Uint8Array(f.mask) }
    other.mask[0] = CELL_HOLE
    expect(board_seed(f.mask, f.width, f.height)).not.toBe(board_seed(other.mask, other.width, other.height))
  })
})

describe('build_slab_geometry — one contiguous slab', () => {
  const base = { cell_size: 2, origin: { x: 0, y: 10, z: 0 }, relief_at: FLAT, thickness: 0.12 }

  test('tops cover floor+obstacle cells; adjacent cells SHARE exact corner coordinates (zero spacing)', () => {
    const mask = new Uint8Array([0, 0, CELL_VOID]) // 3×1 strip, last cell void
    const geo = build_slab_geometry({ ...base, mask, width: 3, height: 1 })
    const { groups } = geo
    expect(groups[0].count).toBe(2 * 6) // 2 top quads (floor cells only)
    // contiguity: the shared edge x=2 exists in BOTH cells' top quads at identical (x, y, z).
    const pos = /** @type {Float32Array} */ (/** @type {any} */ (geo.getAttribute('position')).array)
    const idx = /** @type {any} */ (geo.getIndex()).array
    // walk each top quad's indices (6 per quad, group 0 first) and collect its corner coords.
    const corners_of = (/** @type {number} */ q) => {
      const set = new Set()
      for (let k = 0; k < 6; k += 1) {
        const v = idx[q * 6 + k] * 3
        set.add(`${pos[v]},${pos[v + 1].toFixed(2)},${pos[v + 2]}`)
      }
      return set
    }
    const q0 = corners_of(0)
    const q1 = corners_of(1)
    // both cells' tops contain the SAME exact shared-edge coordinates (x=2 at both z ends) — contiguous.
    for (const c of ['2,10.12,0', '2,10.12,2']) {
      expect(q0.has(c)).toBe(true)
      expect(q1.has(c)).toBe(true)
    }
    geo.dispose()
  })

  test('side skirts: perimeter + hole openings get faces; equal-height interior seams get NONE', () => {
    // [floor, hole, floor] strip — each floor cell: 3 perimeter edges + 1 hole-facing edge = 4 skirts.
    const mask = new Uint8Array([0, CELL_HOLE, 0])
    const geo = build_slab_geometry({ ...base, mask, width: 3, height: 1 })
    expect(geo.groups[1].count).toBe(8 * 6) // 8 side quads
    // [floor, floor] strip — 6 perimeter skirts, ZERO between the two equal-height cells.
    const geo2 = build_slab_geometry({ ...base, mask: new Uint8Array([0, 0]), width: 2, height: 1 })
    expect(geo2.groups[1].count).toBe(6 * 6)
    geo.dispose()
    geo2.dispose()
  })

  test('relief steps: the HIGHER cell owns a step face down to its lower neighbour', () => {
    const mask = new Uint8Array([0, 0])
    const stepped = (/** @type {number} */ x) => (x === 1 ? 1 : 0) // cell 1 one tier up
    const geo = build_slab_geometry({ ...base, mask, width: 2, height: 1, relief_at: stepped })
    expect(geo.groups[1].count).toBe(7 * 6) // 6 perimeter + 1 step face
    geo.dispose()
  })
})
