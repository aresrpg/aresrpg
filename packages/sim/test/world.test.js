// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, test, expect } from 'bun:test'

import {
  CELL,
  WORLD_SEED,
  world_cell,
  is_walkable_world,
  blocks_los_world,
  world_biome,
  continent,
  elevation,
  humidity,
  temperature,
  basin,
  lake,
  forest,
  moisture,
} from '../src/world.js'
import { carve_world_arena } from '../src/arena.js'

const SPAWN_CLEAR_RADIUS = 6 // mirrors world.js
const ONE = 65536 // mirrors world.js Q16 unit
const TYPES = [CELL.FLOOR, CELL.OBSTACLE, CELL.HOLE, CELL.WATER]

/** Largest 4-connected FLOOR component (fraction of all FLOOR) in a window centred at (cx0,cy0). */
const largest_floor_component = (seed, cx0, cy0, H = 80) => {
  const side = 2 * H + 1
  const at = (i, j) => j * side + i
  const floor = new Uint8Array(side * side)
  let total = 0
  for (let j = 0; j < side; j++)
    for (let i = 0; i < side; i++)
      if (world_cell(seed, cx0 - H + i, cy0 - H + j) === CELL.FLOOR) {
        floor[at(i, j)] = 1
        total++
      }
  const seen = new Uint8Array(side * side)
  let best = 0
  for (let start = 0; start < side * side; start++) {
    if (!floor[start] || seen[start]) continue
    let n = 0
    const stack = [start]
    seen[start] = 1
    while (stack.length) {
      const p = stack.pop()
      n++
      const i = p % side
      const j = (p / side) | 0
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const ni = i + di
        const nj = j + dj
        if (ni < 0 || ni >= side || nj < 0 || nj >= side) continue
        const q = at(ni, nj)
        if (floor[q] && !seen[q]) {
          seen[q] = 1
          stack.push(q)
        }
      }
    }
    if (n > best) best = n
  }
  return {
    floor_frac: total / (side * side),
    largest_frac: total ? best / total : 0,
  }
}

/** Count cell types over an inclusive square window. */
const census = (seed, half) => {
  const counts = { 0: 0, 1: 0, 2: 0, 3: 0 }
  for (let x = -half; x <= half; x++)
    for (let y = -half; y <= half; y++) counts[world_cell(seed, x, y)]++
  const total = (2 * half + 1) ** 2
  return { counts, total }
}

describe('world_cell', () => {
  test('deterministic + always a valid integer cell type (incl. negative/large coords)', () => {
    for (const [x, y] of [
      [5, 9],
      [-12, 40],
      [1000, -1000],
      [-9999, -9999],
      [7, 7],
    ]) {
      const a = world_cell(1337, x, y)
      expect(world_cell(1337, x, y)).toBe(a) // same call → same answer
      expect(Number.isInteger(a)).toBe(true)
      expect(TYPES).toContain(a)
    }
  })

  test('no float/NaN leak: every cell in a window is exactly 0|1|2|3', () => {
    for (let x = -60; x <= 60; x++)
      for (let y = -60; y <= 60; y++) {
        const c = world_cell(7, x, y)
        expect(Number.isInteger(c)).toBe(true)
        expect(c >= 0 && c <= 3).toBe(true)
      }
  })

  test('keeps the spawn clearing (Chebyshev<=6) walkable on multiple seeds', () => {
    for (const seed of [1337, 42, 9001])
      for (let x = -SPAWN_CLEAR_RADIUS; x <= SPAWN_CLEAR_RADIUS; x++)
        for (let y = -SPAWN_CLEAR_RADIUS; y <= SPAWN_CLEAR_RADIUS; y++)
          expect(world_cell(seed, x, y)).toBe(CELL.FLOOR)
  })

  test('spawn axis corridor (x=0 / y=0) is FLOOR out past the clearing', () => {
    const seed = 500
    for (let d = -34; d <= 34; d++) {
      expect(world_cell(seed, 0, d)).toBe(CELL.FLOOR)
      expect(world_cell(seed, d, 0)).toBe(CELL.FLOOR)
    }
  })

  test('distribution: floor-dominant, obstacles clustered ~5-18%, holes + ponds present & bounded', () => {
    for (const seed of [99, 7, 123456]) {
      const { counts, total } = census(seed, 100) // 201x201
      expect(counts[CELL.FLOOR]).toBeGreaterThan(total * 0.5)
      expect(counts[CELL.OBSTACLE]).toBeGreaterThan(total * 0.03)
      expect(counts[CELL.OBSTACLE]).toBeLessThan(total * 0.22)
      expect(counts[CELL.HOLE]).toBeGreaterThan(0)
      // ponds present but never an ocean (the regression this guards against)
      expect(counts[CELL.WATER]).toBeGreaterThan(0)
      expect(counts[CELL.WATER]).toBeLessThan(total * 0.2)
    }
  })

  test('coherence: terrain clusters (neighbour type-change rate well below white noise)', () => {
    // White noise over 4 types would change type on ~75% of neighbour pairs; coherent fields are far lower.
    const seed = 99
    let pairs = 0
    let changes = 0
    for (let x = 20; x < 120; x++)
      for (let y = 20; y < 120; y++) {
        const c = world_cell(seed, x, y)
        if (world_cell(seed, x + 1, y) !== c) changes++
        if (world_cell(seed, x, y + 1) !== c) changes++
        pairs += 2
      }
    expect(changes / pairs).toBeLessThan(0.35)
  })

  test('is_walkable_world is true iff FLOOR', () => {
    const walk = is_walkable_world(7)
    for (let x = -20; x < 20; x++)
      for (let y = -20; y < 20; y++)
        expect(walk({ x, y })).toBe(world_cell(7, x, y) === CELL.FLOOR)
  })

  test('blocks_los_world is true iff OBSTACLE — false on HOLE and on WATER', () => {
    const seed = 99
    const blocks = blocks_los_world(seed)
    let saw_hole = false
    let saw_water = false
    for (let x = -120; x < 120; x++)
      for (let y = -120; y < 120; y++) {
        const c = world_cell(seed, x, y)
        expect(blocks({ x, y })).toBe(c === CELL.OBSTACLE)
        if (c === CELL.HOLE) saw_hole = true
        if (c === CELL.WATER) saw_water = true
      }
    expect(saw_hole).toBe(true)
    expect(saw_water).toBe(true)
  })

  test('world_biome stays consistent with world_cell (no precedence drift)', () => {
    // world_biome is a render hint that MUST mirror world_cell's precedence. Assert the invariants
    // that pin them together so a future edit to one without the other fails loudly.
    for (const seed of [7, 42, 9001, 2024])
      for (let x = -60; x <= 60; x += 1)
        for (let y = -60; y <= 60; y += 1) {
          const cell = world_cell(seed, x, y)
          const biome = world_biome(seed, x, y)
          if (cell === CELL.WATER) expect(biome).toBe('water')
          if (biome === 'water') expect(cell).toBe(CELL.WATER)
          // rocky regions are only ever obstacle/hole (big/small rocks) — never floor or water
          if (biome === 'rocky')
            expect([CELL.OBSTACLE, CELL.HOLE]).toContain(cell)
          // forest regions never produce water (water is resolved before forest)
          if (biome === 'forest') expect(cell).not.toBe(CELL.WATER)
        }
  })

  test('navigability: a dominant walkable component (>=60% of FLOOR) holds EVERYWHERE, not just spawn', () => {
    // TEST-ONLY BFS over finite windows — never in shipped sim code (the world is infinite). The
    // origin is trivially open (spawn clearing), so the real guard is the FAR-FROM-ORIGIN windows:
    // they caught a fragmentation regression (largest component had dropped to 31% before the path
    // backbone + stretch-bound fix). Worst observed now ≈74%; 60% is the floor with margin.
    const centers = [
      [0, 0],
      [8000, 3000],
      [-5000, 12000],
      [20000, -9000],
    ]
    for (const seed of [42, 7, 500, 9001, 123456, 2024])
      for (const [cx, cy] of centers) {
        const { largest_frac } = largest_floor_component(seed, cx, cy)
        expect(largest_frac).toBeGreaterThan(0.6)
      }
  })

  test('far-field distribution stays playable (floor majority-ish, water bounded) away from spawn', () => {
    for (const seed of [42, 7, 9001, 2024])
      for (const [cx, cy] of [
        [8000, 3000],
        [-5000, 12000],
      ]) {
        const H = 80
        const counts = { 0: 0, 1: 0, 2: 0, 3: 0 }
        for (let i = -H; i <= H; i++)
          for (let j = -H; j <= H; j++)
            counts[world_cell(seed, cx + i, cy + j)]++
        const total = (2 * H + 1) ** 2
        expect(counts[CELL.FLOOR] / total).toBeGreaterThan(0.3) // not choked out far from spawn
        expect(counts[CELL.WATER] / total).toBeLessThan(0.3) // never an ocean, anywhere
      }
  })

  test('field-spread guard: no climate layer degenerates to a near-constant (silent-tuning-regression catch)', () => {
    // Each field must spread broadly across [0,ONE) — if a future octave/stretch change collapses a
    // layer to mostly-0 or mostly-ONE, the biome classification silently breaks. Assert bounded pinning.
    // Sample a SPARSE WIDE grid (±20k, ~400-cell step) so many lattice cells of even the low-freq
    // fields are covered — a single small window can sit entirely in one highland/basin and skew.
    const layers = {
      continent,
      elevation,
      humidity,
      temperature,
      basin,
      lake,
      forest,
    }
    for (const [name, fn] of Object.entries(layers))
      for (const seed of [7, 9001, 2024]) {
        let zero = 0
        let one = 0
        let sum = 0
        let n = 0
        for (let i = 0; i < 100; i++)
          for (let j = 0; j < 100; j++) {
            const v = fn(i * 411 - 20000, j * 397 - 20000, seed)
            expect(Number.isInteger(v)).toBe(true)
            expect(v >= 0 && v <= ONE).toBe(true)
            if (v === 0) zero++
            if (v === ONE) one++
            sum += v
            n++
          }
        // ridged fields (forest) legitimately pin ~40% to 0 (the fold floor); fbm fields far less.
        const cap = name === 'forest' ? 0.55 : 0.45
        expect(zero / n).toBeLessThan(cap)
        expect(one / n).toBeLessThan(cap)
        expect(sum / n).toBeGreaterThan(ONE * 0.1) // global mean isn't pinned to a rail
        expect(sum / n).toBeLessThan(ONE * 0.9)
      }
  })

  test('roads exist, are FLOOR + biome road, and are deterministic', () => {
    // The POI-lattice road backbone: every cell labelled 'road' MUST be walkable FLOOR (the carve +
    // pathing contract), and the network must actually appear across the world. Pure → re-sampling
    // the same window twice is byte-identical.
    for (const seed of [WORLD_SEED, 7, 9001]) {
      let roads = 0
      for (let x = -120; x <= 120; x++)
        for (let y = -120; y <= 120; y++)
          if (world_biome(seed, x, y) === 'road') {
            expect(world_cell(seed, x, y)).toBe(CELL.FLOOR) // a road is always walkable
            expect(world_cell(seed, x, y)).toBe(world_cell(seed, x, y)) // deterministic
            roads++
          }
      expect(roads).toBeGreaterThan(0) // the network is present
      expect(roads).toBeLessThan(241 * 241 * 0.35) // but a backbone, not a paved world
    }
  })

  test('lakes are coherent WATER regions (a contiguous body, not just speckle ponds)', () => {
    // A lake must form at least one BIG connected WATER component somewhere across the world — the
    // "coherent region, not salt-and-pepper" guarantee. Scan wide windows; require a fat blob.
    const biggest_water_blob = (seed, cx0, cy0, H = 120) => {
      const side = 2 * H + 1
      const at = (i, j) => j * side + i
      const wet = new Uint8Array(side * side)
      for (let j = 0; j < side; j++)
        for (let i = 0; i < side; i++)
          if (world_cell(seed, cx0 - H + i, cy0 - H + j) === CELL.WATER)
            wet[at(i, j)] = 1
      const seen = new Uint8Array(side * side)
      let best = 0
      for (let start = 0; start < side * side; start++) {
        if (!wet[start] || seen[start]) continue
        let n = 0
        const stack = [start]
        seen[start] = 1
        while (stack.length) {
          const p = stack.pop()
          n++
          const i = p % side
          const j = (p / side) | 0
          for (const [di, dj] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const ni = i + di
            const nj = j + dj
            if (ni < 0 || ni >= side || nj < 0 || nj >= side) continue
            const q = at(ni, nj)
            if (wet[q] && !seen[q]) {
              seen[q] = 1
              stack.push(q)
            }
          }
        }
        if (n > best) best = n
      }
      return best
    }
    // at least one seed/window shows a fat lake (>120 contiguous water cells)
    let saw_lake = false
    for (const seed of [WORLD_SEED, 7, 42, 9001, 2024])
      for (const [cx, cy] of [
        [0, 0],
        [4000, -2000],
        [-7000, 5000],
      ])
        if (biggest_water_blob(seed, cx, cy) > 120) saw_lake = true
    expect(saw_lake).toBe(true)
  })

  test('new render biomes never violate the gameplay-cell contract', () => {
    // road/beach/meadow are render hints on WALKABLE FLOOR; water is the only water biome. Pin them so
    // a future edit that makes a road non-walkable (breaking the fight carve) fails loudly here.
    for (const seed of [7, 42, 9001])
      for (let x = -90; x <= 90; x++)
        for (let y = -90; y <= 90; y++) {
          const biome = world_biome(seed, x, y)
          const cell = world_cell(seed, x, y)
          if (biome === 'road' || biome === 'beach')
            expect(cell).toBe(CELL.FLOOR) // walkable → fight-board carve stays valid
          if (biome === 'meadow')
            expect([CELL.FLOOR, CELL.HOLE]).toContain(cell)
          if (cell === CELL.WATER) expect(biome).toBe('water')
        }
  })

  test('fight-board carve treats WATER as a non-walkable obstacle (real-terrain window contract)', () => {
    // carve_world_arena keys on `=== CELL.FLOOR`; on a PURE real-terrain window every non-FLOOR world cell
    // (incl. WATER) is an arena obstacle (value 1). OWNER-991: the bounds ARE the real terrain window, so the
    // walkable set mirrors FLOOR exactly UNLESS the playability guard forced a clearing (a FLOOR-starved window).
    // We therefore anchor on a water-containing window where the guard did NOT fire (every walkable cell is real
    // FLOOR) so the WATER→obstacle contract is exact.
    const seed = WORLD_SEED
    // The carve ROLLS its own width + height from the fight seed (deterministic-random, NON-SQUARE board),
    // independent of the anchor — so a probe carve reveals the rolled dims + center used for EVERY anchor at
    // this seed (cap 8, rng 1234). The center is (floor(width/2), floor(height/2)); origin = anchor - center.
    const rng = 1234
    const { width, height, center } = carve_world_arena(seed, 0, 0, 8, rng)
    // find an anchor whose window contains water AND carves a pure real-terrain board (no forced clearing →
    // every walkable cell is real FLOOR), so the WATER/non-FLOOR → obstacle contract holds without exception.
    let anchor = null
    for (let ay = 100; ay < 800 && !anchor; ay += 3)
      for (let ax = 100; ax < 800 && !anchor; ax += 3) {
        const origin_x = ax - center.x
        const origin_y = ay - center.y
        const arena = carve_world_arena(seed, ax, ay, 8, rng)
        let wet = false
        let forced = false
        for (let ly = 0; ly < height; ly++)
          for (let lx = 0; lx < width; lx++) {
            const wc = world_cell(seed, origin_x + lx, origin_y + ly)
            if (wc === CELL.WATER) wet = true
            const is_center = lx === center.x && ly === center.y
            // a non-FLOOR walkable cell (excl. center) means the playability guard forced a clearing here
            if (
              arena.cells[ly * width + lx] === 0 &&
              wc !== CELL.FLOOR &&
              !is_center
            )
              forced = true
          }
        if (wet && !forced) anchor = { x: ax, y: ay }
      }
    expect(anchor).not.toBeNull()
    const a = /** @type {{x:number,y:number}} */ (anchor)
    const arena = carve_world_arena(seed, a.x, a.y, 8, rng)
    const origin_x = a.x - center.x
    const origin_y = a.y - center.y
    let checked = 0
    for (let ly = 0; ly < height; ly++)
      for (let lx = 0; lx < width; lx++) {
        const wc = world_cell(seed, origin_x + lx, origin_y + ly)
        const board = arena.cells[ly * width + lx]
        const is_center = lx === center.x && ly === center.y
        if (wc === CELL.WATER && !is_center) {
          expect(board).toBe(1) // water is a board obstacle, never walkable
          checked++
        }
        if (wc !== CELL.FLOOR && !is_center) expect(board).toBe(1) // and so is every non-FLOOR cell
      }
    expect(checked).toBeGreaterThan(0)
    // carve stays deterministic/byte-identical on a re-carve
    const again = carve_world_arena(seed, a.x, a.y, 8, rng)
    expect(Array.from(again.cells)).toEqual(Array.from(arena.cells))
  })
})

const HALF = ONE >> 1 // ONE is declared at the top of this file (Q16 unit)

describe('moisture (server node-spawn wetness — SSOT, ported from forest.js float)', () => {
  test('is deterministic, integer-only, and bounded to [0, ONE]', () => {
    for (const seed of [WORLD_SEED, 1, 99999]) {
      for (let y = -40; y < 40; y += 7)
        for (let x = -40; x < 40; x += 7) {
          const m = moisture(seed, x, y)
          expect(m).toBe(moisture(seed, x, y)) // same inputs -> same output
          expect(Number.isInteger(m)).toBe(true) // no floats leak into the field
          expect(m).toBeGreaterThanOrEqual(0)
          expect(m).toBeLessThanOrEqual(ONE)
        }
    }
  })

  test('matches the float formula it replaced (humid*0.9 + (1-basin)*0.28)', () => {
    // Parity within integer-flooring tolerance so the client render (which divides by ONE) and the
    // server spawner agree on the same wet/dry world. Sampled across cells.
    for (let i = 0; i < 200; i++) {
      const x = (i * 37) % 500
      const y = (i * 53) % 500
      const expected = Math.min(
        ONE,
        Math.floor((humidity(x, y, WORLD_SEED) * 58982) / ONE) +
          Math.floor(((ONE - basin(x, y, WORLD_SEED)) * 18350) / ONE),
      )
      expect(moisture(WORLD_SEED, x, y)).toBe(expected)
    }
  })

  test('both wet (> HALF) and dry cells exist (non-degenerate field)', () => {
    let wet = 0
    let dry = 0
    for (let y = 0; y < 120; y++)
      for (let x = 0; x < 120; x++)
        if (moisture(WORLD_SEED, x, y) > HALF) wet++
        else dry++
    expect(wet).toBeGreaterThan(0)
    expect(dry).toBeGreaterThan(0)
  })
})
