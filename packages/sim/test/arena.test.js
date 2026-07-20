import { describe, test, expect } from 'bun:test'

import { carve_world_arena } from '../src/arena.js'
import { obstacle_at, squirrel_noise_2d } from '../src/noise.js'
import { cell_key, neighbors_4dir } from '../src/cell.js'
import { CELL, WORLD_SEED, world_cell } from '../src/world.js'

const WALKABLE = 0

const idx = (width, x, y) => y * width + x

// Count cells reachable by 4-dir BFS from the center over walkable terrain. NON-SQUARE aware (height defaults
// to width for the square procedural carve).
const flood_count = ({ width, height = width, center, cells }) => {
  const seen = new Set([cell_key(center.x, center.y)])
  let frontier = [center]
  while (frontier.length > 0) {
    const next = []
    for (const cell of frontier) {
      for (const { x, y } of neighbors_4dir(cell)) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        if (cells[idx(width, x, y)] !== WALKABLE) continue
        const key = cell_key(x, y)
        if (seen.has(key)) continue
        seen.add(key)
        next.push({ x, y })
      }
    }
    frontier = next
  }
  return seen.size
}

describe('squirrel noise', () => {
  test('2d hash is pure and order-independent', () => {
    expect(squirrel_noise_2d(3, 7, 42)).toBe(squirrel_noise_2d(3, 7, 42))
    // different positions / seeds diverge
    expect(squirrel_noise_2d(3, 7, 42)).not.toBe(squirrel_noise_2d(7, 3, 42))
    expect(squirrel_noise_2d(3, 7, 42)).not.toBe(squirrel_noise_2d(3, 7, 43))
  })

  test('hash output stays a uint32', () => {
    const v = squirrel_noise_2d(-12, 99, 7)
    expect(Number.isInteger(v)).toBe(true)
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThanOrEqual(0xffffffff)
  })

  test('obstacle_at is deterministic per cell', () => {
    expect(obstacle_at(5, 5, 1)).toBe(obstacle_at(5, 5, 1))
  })
})

describe('carve_world_arena — fight board from real terrain (NON-SQUARE, #30)', () => {
  // The carve ROLLS its own width + height INDEPENDENTLY from the fight seed (deterministic-random, NON-SQUARE
  // board); `max_radius` is just the upper safety cap (clamps either dim to 2*max_radius+1). max_radius=12 so the
  // full ranges (width ∈ [10..18], height ∈ [7..24]) apply un-clipped (the production ARENA_RADIUS). Geometry
  // below keys on the carved `arena.width`/`arena.height` + `arena.center`, never a single radius.
  const max_radius = 12
  const rng_seed = 0x1234abcd

  // the area-scaled MIN_FIGHT_CELLS floor (the playability guard's target; mirrors arena.js: 48 at 13x13).
  const min_fight_cells = (width, height) =>
    ((48 * width * height) / (13 * 13)) | 0

  // a few anchors offset from origin so the window samples genuine overworld terrain (a spread of densities)
  const anchors = /** @type {[number, number][]} */ ([
    [40, 40],
    [-37, 58],
    [120, -90],
  ])

  // ── deterministic-random board SIZE: VARIED + NON-SQUARE (#30: width != height per fight) ──
  test('board dims are deterministic-random — width ∈ [10..18], height ∈ [7..24], REPLAYABLE, often W != H', () => {
    const [[ax, ay]] = anchors
    const widths = new Set()
    const heights = new Set()
    let non_square = 0
    // vary the per-fight seed (the live `fight_seed` varies per encounter location) over a spread; each roll is
    // a valid compact size, deterministic for its seed, and the spread visits more than one size on each axis.
    for (let s = 1; s <= 80; s++) {
      const a = carve_world_arena(WORLD_SEED, ax, ay, max_radius, s)
      const b = carve_world_arena(WORLD_SEED, ax, ay, max_radius, s)
      expect(a.width).toBe(b.width) // same seed → same dims
      expect(a.height).toBe(b.height)
      expect(a.width).toBeGreaterThanOrEqual(10)
      expect(a.width).toBeLessThanOrEqual(18)
      expect(a.height).toBeGreaterThanOrEqual(7)
      expect(a.height).toBeLessThanOrEqual(24)
      expect(a.center).toEqual({ x: a.width >> 1, y: a.height >> 1 })
      expect(a.cells.length).toBe(a.width * a.height)
      if (a.width !== a.height) non_square++
      widths.add(a.width)
      heights.add(a.height)
    }
    expect(widths.size).toBeGreaterThan(1) // width genuinely varies across fight seeds
    expect(heights.size).toBeGreaterThan(1) // height genuinely varies across fight seeds
    expect(non_square).toBeGreaterThan(0) // the board is genuinely non-square (W != H) for many seeds
  })

  test('byte-identical for the same (world_seed, anchor, max_radius, rng_seed) — determinism', () => {
    for (const [ax, ay] of anchors) {
      const a = carve_world_arena(WORLD_SEED, ax, ay, max_radius, rng_seed)
      const b = carve_world_arena(WORLD_SEED, ax, ay, max_radius, rng_seed)
      expect(Array.from(a.cells)).toEqual(Array.from(b.cells))
      expect(a.spawns_a).toEqual(b.spawns_a)
      expect(a.spawns_b).toEqual(b.spawns_b)
      expect(a.width).toBe(b.width)
      expect(a.height).toBe(b.height)
      expect(a.cells.length).toBe(a.width * a.height)
    }
  })

  test('walkable cells are real FLOOR terrain on a non-degenerate window (the real-terrain window, no synthetic mask)', () => {
    // OWNER-991: the board bounds ARE the real terrain window — every walkable cell is genuine FLOOR (the
    // boundary is carved by the actual trees/rocks/water, not a synthetic ellipse). On a window with ample FLOOR
    // (above the playability floor) the forced clearing never fires, so EVERY non-center walkable cell is FLOOR.
    const [, , [ax, ay]] = anchors // [120,-90]: an organic mixed window, well above the floor (no clearing)
    const arena = carve_world_arena(WORLD_SEED, ax, ay, max_radius, rng_seed)
    const { width, height, center } = arena
    let walkable = 0
    for (let ly = 0; ly < height; ly++)
      for (let lx = 0; lx < width; lx++) {
        if (arena.cells[ly * width + lx] !== WALKABLE) continue
        walkable++
        if (lx === center.x && ly === center.y) continue // center is force-walkable regardless of terrain
        const wx = ax - center.x + lx
        const wy = ay - center.y + ly
        // every walkable cell is real FLOOR (no synthetic mask added walkable cells over non-FLOOR terrain)
        expect(world_cell(WORLD_SEED, wx, wy)).toBe(CELL.FLOOR)
      }
    expect(walkable).toBeGreaterThanOrEqual(min_fight_cells(width, height)) // not degenerate (no clearing needed)
    expect(walkable).toBeLessThan(width * height) // real terrain carved an organic edge — not the full window
  })

  test('every walkable cell is connected to the center (no isolated pockets)', () => {
    for (const [ax, ay] of anchors) {
      const arena = carve_world_arena(WORLD_SEED, ax, ay, max_radius, rng_seed)
      const walkable = arena.cells.reduce(
        (n, v) => n + (v === WALKABLE ? 1 : 0),
        0,
      )
      expect(flood_count(arena)).toBe(walkable)
    }
  })

  test('spawn sets are disjoint and on walkable cells', () => {
    const [, [ax, ay]] = anchors
    const arena = carve_world_arena(WORLD_SEED, ax, ay, max_radius, rng_seed)
    const { width } = arena
    const a_keys = new Set(arena.spawns_a.map(c => cell_key(c.x, c.y)))
    for (const c of arena.spawns_b)
      expect(a_keys.has(cell_key(c.x, c.y))).toBe(false)
    for (const c of [...arena.spawns_a, ...arena.spawns_b])
      expect(arena.cells[c.y * width + c.x]).toBe(WALKABLE)
  })

  // ── OWNER-991: the board bounds ARE the real-terrain window (the inscribed-ELLIPSE mask is GONE) ──
  // On open ground every cell is FLOOR, so the real-terrain window fills the WHOLE rectangle (a clean rectangle
  // of real plains is now the intended open-ground board — the design is the genuine terrain window, not a
  // synthetic diamond). The four corners are walkable on an open window (the old mask forced them obstacle).
  test('open window IS the full real-terrain rectangle (no synthetic mask trims open ground)', () => {
    const open_anchor = /** @type {[number, number]} */ ([-170, -35]) // a fully-FLOOR (open plains) window
    const arena = carve_world_arena(
      WORLD_SEED,
      open_anchor[0],
      open_anchor[1],
      max_radius,
      rng_seed,
    )
    const { width, height, cells } = arena
    // every cell in the window is real FLOOR, so the board fills the window — the corners included
    let floor = 0
    let walkable = 0
    for (let ly = 0; ly < height; ly++)
      for (let lx = 0; lx < width; lx++) {
        if (
          world_cell(
            WORLD_SEED,
            open_anchor[0] - (width >> 1) + lx,
            open_anchor[1] - (height >> 1) + ly,
          ) === CELL.FLOOR
        )
          floor++
        if (cells[idx(width, lx, ly)] === WALKABLE) walkable++
      }
    expect(floor).toBe(width * height) // sanity: this anchor is a genuinely open window
    expect(walkable).toBe(width * height) // the board fills it — the synthetic ellipse mask is gone
    const last_x = width - 1
    const last_y = height - 1
    for (const [cx, cy] of [
      [0, 0],
      [0, last_y],
      [last_x, 0],
      [last_x, last_y],
    ])
      expect(cells[idx(width, cx, cy)]).toBe(WALKABLE) // corners walkable on an open window (no mask)
  })

  test('a FLOOR-starved window falls back to a minimum playable core (never a degenerate board)', () => {
    // PLAYABILITY GUARD: a window anchored on a near-isolated FLOOR cell amid water/forest would carve too few
    // connected cells to seat two teams. The guard forces a minimal centered CLEARING (not the old ellipse) so
    // the connected core reaches the area-scaled floor and both teams seat — the carve NEVER ships a degenerate
    // board. ([-199,142]: only the center FLOOR cell is connected at clearing=0 → the guard fires.)
    const [ax, ay] = [-199, 142]
    const arena = carve_world_arena(WORLD_SEED, ax, ay, max_radius, rng_seed)
    const walkable = arena.cells.reduce(
      (n, v) => n + (v === WALKABLE ? 1 : 0),
      0,
    )
    // the forced clearing recovered a fair playable core (>= the area-scaled floor)
    expect(walkable).toBeGreaterThanOrEqual(
      min_fight_cells(arena.width, arena.height),
    )
    // still fully connected to the center (the guard keeps the flood-fill invariant)
    expect(flood_count(arena)).toBe(walkable)
    // both teams seat — the degenerate window is now playable
    expect(arena.spawns_a.length).toBeGreaterThan(0)
    expect(arena.spawns_b.length).toBeGreaterThan(0)
  })

  test('both teams get a spawn whenever the play-shape has ≥2 connected cells (robust pole-split)', () => {
    // The terrain window's shape is fixed, so a lopsided organic+terrain region must not empty a team. The
    // pole-split guarantees both sides non-empty for any region of ≥2 cells (a 1-cell island is the only
    // unseatable case). Fuzz a band of anchors; every carve with ≥2 walkable cells seats both teams.
    for (let ax = -40; ax <= 140; ax += 11)
      for (let ay = -40; ay <= 140; ay += 11) {
        const arena = carve_world_arena(
          WORLD_SEED,
          ax,
          ay,
          max_radius,
          rng_seed,
        )
        const walkable = arena.cells.reduce(
          (n, v) => n + (v === WALKABLE ? 1 : 0),
          0,
        )
        if (walkable < 2) continue
        expect(arena.spawns_a.length).toBeGreaterThan(0)
        expect(arena.spawns_b.length).toBeGreaterThan(0)
      }
  })

  test('6+6 placement cells fit the rolled board (open board + every fair-sized carve)', () => {
    // SPAWNS_PER_TEAM=6 both teams must still fit on the smaller board. (1) the fully-open window seats a full
    // 6+6 at EVERY rolled size; (2) across a fuzz of seeds × anchors, any fair-sized board (≥40 connected cells)
    // seats 6+6 — only a genuinely tight terrain-starved region clamps below 6 (the graceful-clamp escape hatch).
    for (let s = 1; s <= 24; s++) {
      const open = carve_world_arena(WORLD_SEED, -60, 59, max_radius, s)
      expect(open.spawns_a.length).toBe(6)
      expect(open.spawns_b.length).toBe(6)
      for (let ax = -40; ax <= 120; ax += 20)
        for (let ay = -40; ay <= 120; ay += 20) {
          const arena = carve_world_arena(WORLD_SEED, ax, ay, max_radius, s)
          const walkable = arena.cells.reduce(
            (n, v) => n + (v === WALKABLE ? 1 : 0),
            0,
          )
          // every team always seats at most the full 6 (deterministic clamp), and a fair board seats exactly 6
          expect(arena.spawns_a.length).toBeLessThanOrEqual(6)
          expect(arena.spawns_b.length).toBeLessThanOrEqual(6)
          if (walkable < 40) continue
          expect(arena.spawns_a.length).toBe(6)
          expect(arena.spawns_b.length).toBe(6)
        }
    }
  })

  test('CONNECTIVITY: both team spawns share ONE walkable component — a real bridge always links them (lake-split guard)', () => {
    // The lake case (design flag): a water body can split a window into shores, which would strand red on one
    // shore and blue on the other with NO walkable bridge (melee could never engage). The carve flood-fills from
    // the center every stamp and DROPS every disconnected pocket, so the shipped board is a SINGLE connected
    // walkable component and BOTH spawn poles sit inside it — connectivity is enforced UNCONDITIONALLY, never a
    // mere cell-count pass that could split the map. Assert it directly: a BFS over walkable cells from a spawn_a
    // cell reaches EVERY spawn_b cell (and vice versa), so a real dry path bridges the teams. WATER blocks
    // movement (an obstacle) but passes LOS; the single-component guarantee always leaves a walkable path.
    // Fuzzed over a wide anchor band PLUS known water-heavy / FLOOR-starved windows where the guard fires.
    const reaches_all = (arena, from, targets) => {
      const { width, height, cells } = arena
      const seen = new Set([cell_key(from.x, from.y)])
      let frontier = [from]
      while (frontier.length > 0) {
        const next = []
        for (const cell of frontier)
          for (const { x, y } of neighbors_4dir(cell)) {
            if (x < 0 || y < 0 || x >= width || y >= height) continue
            if (cells[idx(width, x, y)] !== WALKABLE) continue
            const key = cell_key(x, y)
            if (seen.has(key)) continue
            seen.add(key)
            next.push({ x, y })
          }
        frontier = next
      }
      return targets.every(t => seen.has(cell_key(t.x, t.y)))
    }
    const probes = /** @type {[number, number][]} */ ([
      [-260, -43], // a water-heavy window — the guard fires, bridging a connected clearing
      [-260, -197], // a partial-lake / FLOOR-starved window (guard fires)
      [-199, 142], // a near-isolated FLOOR cell amid water/forest (guard fires)
    ])
    for (let ax = -40; ax <= 140; ax += 9)
      for (let ay = -40; ay <= 140; ay += 9) probes.push([ax, ay])
    for (const [ax, ay] of probes) {
      const arena = carve_world_arena(WORLD_SEED, ax, ay, max_radius, rng_seed)
      const walkable = arena.cells.reduce(
        (n, v) => n + (v === WALKABLE ? 1 : 0),
        0,
      )
      if (walkable < 2) continue
      // single connected component: flood from center reaches EVERY walkable cell (no off-island pocket)
      expect(flood_count(arena)).toBe(walkable)
      // both teams seated AND mutually reachable over walkable cells (a real bridge — never a shore split)
      expect(arena.spawns_a.length).toBeGreaterThan(0)
      expect(arena.spawns_b.length).toBeGreaterThan(0)
      const [from_a] = arena.spawns_a
      const [from_b] = arena.spawns_b
      if (!from_a || !from_b) continue
      expect(reaches_all(arena, from_a, arena.spawns_b)).toBe(true)
      expect(reaches_all(arena, from_b, arena.spawns_a)).toBe(true)
    }
  })
})
