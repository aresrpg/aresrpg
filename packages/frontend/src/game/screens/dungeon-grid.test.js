// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, it } from 'bun:test'

import {
  hashSeed,
  generateGrid,
  start_cells_of,
  wallCells,
  legal_move_path,
  dungeon_grid_of,
  placement_cells_of,
  maskWords,
  board_seed_from_anchor,
  board_shape_from_anchor,
  crossMask,
  dungeon_blocked_cells,
} from './dungeon-grid.js'
import { encode, bfsPathCost, bfsPath, GRID_W, GRID_CELLS } from '@aresrpg/fight'

// D75 — cells are CANONICAL stride-20 (fight-los GRID_W) everywhere in the client. The Move determinism
// contract is pinned MOVE-NATIVE (dungeon_grid_test.move golden vectors); `generateGrid` is a DEV/TEST twin
// only (force_fight_board + these invariants), NEVER a runtime path — so this file pins JS-side determinism +
// invariants + the LIVE-board glue (`dungeon_grid_of`: stored-mask train-4 vs legacy-rect train-3), not a
// byte-contract against Move.

describe('dungeon-grid / hashSeed (mirrors dungeon_grid_test.move::hash_seed_matches_js)', () => {
  it('ascending [0..31] === 152284517', () => {
    const ascending = Array.from({ length: 32 }, (_, i) => i)
    expect(hashSeed(ascending)).toBe(152284517)
  })
  it('mixed [(i*7+3)&0xFF] === 417890693', () => {
    const mixed = Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff)
    expect(hashSeed(mixed)).toBe(417890693)
  })
})

describe('dungeon-grid / generateGrid (D75 dev/test twin — determinism + invariants at canonical stride 20)', () => {
  // JS-side determinism pins (captured from THIS twin; the load-bearing determinism gate is Move-native).
  it('generate(0, 0) is stable', () => {
    const g = generateGrid(0, 0)
    expect([g.width, g.height, g.shape_mask.size]).toEqual([7, 9, 55])
    expect(g.obstacles).toEqual([82, 43])
    expect(g.holes).toEqual([123, 65, 105])
    expect(g.start_cells_a).toEqual([1, 2, 3, 4, 5, 21])
    expect(g.start_cells_b).toEqual([165, 164, 163, 162, 161, 145])
  })
  it('generate(0xDEADBEEF, 3) is stable', () => {
    const g = generateGrid(0xdeadbeef, 3)
    expect([g.width, g.height, g.shape_mask.size]).toEqual([14, 14, 106])
    expect(g.obstacles).toEqual([225, 227, 67, 125])
    expect(g.holes).toEqual([147, 185])
    expect(g.start_cells_a).toEqual([4, 5, 6, 7, 8, 24])
    expect(g.start_cells_b).toEqual([268, 267, 266, 265, 264, 248])
  })
  it('same seed twice → byte-identical output (pure)', () => {
    const a = generateGrid(12345, 1)
    const b = generateGrid(12345, 1)
    expect([...a.shape_mask].sort((x, y) => x - y)).toEqual([...b.shape_mask].sort((x, y) => x - y))
    expect(a.obstacles).toEqual(b.obstacles)
    expect(a.holes).toEqual(b.holes)
    expect(a.start_cells_a).toEqual(b.start_cells_a)
    expect(a.start_cells_b).toEqual(b.start_cells_b)
    expect(maskWords(a.shape_mask)).toEqual(maskWords(b.shape_mask))
  })
  for (const [hash, room] of [
    [0, 0],
    [0xdeadbeef, 3],
    [12345, 1],
    [0xffffffff, 7],
    [777, 2],
  ]) {
    it(`generate(${hash}, ${room}) → D75 invariants hold (mirrors dungeon_grid_test.move::invariants_hold)`, () => {
      const g = generateGrid(hash, room)
      // dims inside the D75 vocabulary; every mask cell inside [0,width)×[0,height) at stride 20.
      expect(g.width).toBeGreaterThanOrEqual(7)
      expect(g.width).toBeLessThanOrEqual(17)
      expect(g.height).toBeGreaterThanOrEqual(7)
      expect(g.height).toBeLessThanOrEqual(19)
      for (const c of g.shape_mask) {
        expect(c % GRID_W).toBeLessThan(g.width)
        expect((c / GRID_W) | 0).toBeLessThan(g.height)
      }
      // blockers: on-mask, disjoint, never on a start cell.
      const blocked = new Set([...g.obstacles, ...g.holes])
      expect(blocked.size).toBe(g.obstacles.length + g.holes.length) // disjoint
      for (const c of blocked) expect(g.shape_mask.has(c)).toBe(true)
      // starts: 6/side, distinct, on-mask, unblocked, OPPOSITE BANDS (every a-row strictly above every b-row).
      expect(g.start_cells_a).toHaveLength(6)
      expect(g.start_cells_b).toHaveLength(6)
      const all = [...g.start_cells_a, ...g.start_cells_b]
      expect(new Set(all).size).toBe(12)
      for (const c of all) {
        expect(g.shape_mask.has(c)).toBe(true)
        expect(blocked.has(c)).toBe(false)
      }
      const max_a_row = Math.max(...g.start_cells_a.map(c => (c / GRID_W) | 0))
      const min_b_row = Math.min(...g.start_cells_b.map(c => (c / GRID_W) | 0))
      expect(max_a_row).toBeLessThan(min_b_row)
    })
  }
})

describe('dungeon-grid / dungeon_grid_of — the LIVE-board glue (stored mask = train-4, legacy rect = train-3)', () => {
  it('a STORED mask drives the grid verbatim (no re-derivation, no rectangle assumption)', () => {
    const mask = generateGrid(0xdeadbeef, 3).shape_mask
    const dungeon = {
      id: '0xmasked',
      room_index: 3,
      shape_mask: mask,
      grid_width: 14,
      grid_height: 14,
      obstacles: [225, 227],
      holes: [147],
      start_cells_a: [4, 5, 6],
      start_cells_b: [268, 267, 266],
      escrow: [],
      mobs: [],
    }
    const g = dungeon_grid_of(dungeon)
    expect(g.shape_mask).toBe(mask) // the stored truth, not a copy of a twin
    expect([g.width, g.height]).toEqual([14, 14])
    expect(g.obstacles).toEqual([225, 227])
    expect(g.holes).toEqual([147])
    // placement = EXACTLY the stored list (both bands) — the old y<2 derivation is dead on a masked record.
    expect(placement_cells_of(dungeon)).toEqual([4, 5, 6, 268, 267, 266])
    // walls fold ¬mask: an off-mask cell is a wall, an on-mask unblocked cell is not.
    const walls = wallCells(g)
    for (let c = 0; c < GRID_CELLS; c++)
      if (!mask.has(c)) {
        expect(walls.has(c)).toBe(true)
        break
      }
    expect(walls.has(225)).toBe(true) // obstacle
    expect(walls.has(147)).toBe(true) // hole
  })

  it('a record WITHOUT proven dims is NOT PRESENTABLE — the null hold, never an invented 10×10 frame', () => {
    // Never fall back when a proper system is missing data: the old `grid_width || 10` invention
    // presented a phantom frame for a torn/gridless record — placement clicks aimed at a board the fight
    // never had. The fold now HOLDS (null); the adoption gate upstream (fight_geometry_complete) keeps such
    // records from ever presenting, so a null here surfaces a pipeline bug loudly instead of painting one.
    const dungeon = { id: '0xlegacy', room_index: 0, escrow: [], mobs: [], obstacles: [], holes: [] }
    expect(dungeon_grid_of(dungeon)).toBeNull()
    // the held null NEVER masks the healed read: same id#room with real dims resolves the REAL grid
    const healed = { ...dungeon, grid_width: 8, grid_height: 12 }
    expect([dungeon_grid_of(healed).width, dungeon_grid_of(healed).height]).toEqual([8, 12])
  })

  it('a NO-MASK record with STORED dims respects them', () => {
    const dungeon = { id: '0xdims', room_index: 0, grid_width: 8, grid_height: 12, escrow: [], mobs: [] }
    const g = dungeon_grid_of(dungeon)
    expect([g.width, g.height]).toEqual([8, 12])
    expect(g.shape_mask.size).toBe(96)
  })

  it('legacy placement synthesis: no stored starts → the pre-D75 rule (y<2 ∩ walkable, centre-ranked 6)', () => {
    const dungeon = { id: '0xlegacy2', room_index: 0, grid_width: 10, grid_height: 10, escrow: [], mobs: [], obstacles: [encode(4, 0)], holes: [] }
    const cells = placement_cells_of(dungeon)
    expect(cells).toHaveLength(6)
    const cx = (10 - 1) / 2
    let worst = -1
    for (const c of cells) {
      const x = c % GRID_W
      const y = (c / GRID_W) | 0
      expect(y).toBeLessThan(2) // spawn rows — the legacy contract gate (combat_grid::is_start_cell)
      expect(x).toBeLessThan(10) // inside the rect
      expect(c).not.toBe(encode(4, 0)) // never the obstacle
      worst = Math.max(worst, Math.abs(x - cx))
    }
    // centre-ranked: every REJECTED walkable spawn cell is no closer to the centre column than the worst chosen.
    const chosen = new Set(cells)
    for (let y = 0; y < 2; y++)
      for (let x = 0; x < 10; x++) {
        const c = encode(x, y)
        if (chosen.has(c) || c === encode(4, 0)) continue
        expect(Math.abs(x - cx)).toBeGreaterThanOrEqual(worst)
      }
    // deterministic
    expect(placement_cells_of({ ...dungeon, id: '0xlegacy2' })).toEqual(cells)
  })

  it('stored starts (even without a mask) are NEVER overridden by the synthesis', () => {
    const dungeon = { id: '0xstored', room_index: 0, grid_width: 10, grid_height: 10, start_cells_a: [encode(2, 5)], escrow: [], mobs: [] }
    expect(start_cells_of(dungeon_grid_of(dungeon))).toEqual([encode(2, 5)])
  })

  it('a CROSS mask renders correctly — the corners fall OFF the shape (VOID), the centre is floor', () => {
    // middle 3 rows full-width ∪ middle 3 cols full-height — a plus sign; the four corners are off-shape.
    const mask = crossMask(9, 9, 3, 6, 3, 6)
    const dungeon = { id: '0xCROSS', room_index: 0, grid_width: 9, grid_height: 9, shape_mask: mask, obstacles: [], holes: [], start_cells_a: [], start_cells_b: [] }
    const g = dungeon_grid_of(dungeon)
    expect([g.width, g.height]).toEqual([9, 9]) // the REAL dims, never the legacy 10×10 square
    expect(g.shape_mask.has(encode(0, 0))).toBe(false) // top-left corner — VOID (off the cross)
    expect(g.shape_mask.has(encode(8, 8))).toBe(false) // bottom-right corner — VOID
    expect(g.shape_mask.has(encode(0, 4))).toBe(true) // the horizontal bar reaches the left edge — floor
    expect(g.shape_mask.has(encode(4, 4))).toBe(true) // dead centre — floor
    // every off-mask (VOID) cell is a movement wall (wallCells folds ¬mask ∪ obstacles ∪ holes)
    expect(wallCells(g).has(encode(0, 0))).toBe(true)
  })
})

describe('board_shape_from_anchor — the ENGINE fight board (SDK mask decode is lossy → regenerate from the seed)', () => {
  it('board_seed_from_anchor is a deterministic u32 fold; a 1-block anchor shift changes the board', () => {
    const seed = board_seed_from_anchor(0x1234abcd, 512, 768)
    expect(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff).toBe(true)
    expect(board_seed_from_anchor(0x1234abcd, 512, 768)).toBe(seed) // same inputs → same seed
    expect(board_seed_from_anchor(0x1234abcd, 513, 768)).not.toBe(seed) // a different anchor → a different board
  })
  it('board_shape_from_anchor(ws, x, z) === generateGrid(board_seed, 0) — the variant-0 fight board', () => {
    const a = board_shape_from_anchor(0x1234abcd, 512, 768)
    const b = generateGrid(board_seed_from_anchor(0x1234abcd, 512, 768), 0)
    expect([a.width, a.height]).toEqual([b.width, b.height])
    expect([...a.shape_mask].sort((x, y) => x - y)).toEqual([...b.shape_mask].sort((x, y) => x - y))
    expect(a.obstacles).toEqual(b.obstacles)
    expect(a.holes).toEqual(b.holes)
    expect(board_shape_from_anchor(null, 0, 0)).toBe(null) // no seed → no twin (never regenerate from nothing)
  })
})

describe('fight-los / bfsPathCost + bfsPath (mirrors combat_grid_bfs_test.move)', () => {
  it('clear line costs manhattan; same cell is 0', () => {
    expect(bfsPathCost(encode(0, 0), encode(3, 0), new Set(), 5)).toBe(3)
    expect(bfsPathCost(encode(4, 4), encode(4, 4), new Set(), 5)).toBe(0)
  })
  it('a wall forces a detour (cost > manhattan)', () => {
    const blocked = new Set([encode(1, 0)])
    expect(bfsPathCost(encode(0, 0), encode(2, 0), blocked, 6)).toBe(4) // (0,0)(0,1)(1,1)(2,1)(2,0)
    // the DRAWN path length == the charge: the up-and-over route is 4 steps.
    expect(bfsPath(encode(0, 0), encode(2, 0), blocked, 6)).toHaveLength(4)
  })
  it('detour over budget is unreachable', () => {
    const blocked = new Set([encode(1, 0)])
    expect(bfsPathCost(encode(0, 0), encode(2, 0), blocked, 3)).toBe(GRID_CELLS)
    expect(bfsPath(encode(0, 0), encode(2, 0), blocked, 3)).toEqual([])
  })
  it('a fully-walled target is unreachable (body-blocking seals a cell)', () => {
    const blocked = new Set([encode(4, 5), encode(6, 5), encode(5, 4), encode(5, 6)])
    expect(bfsPathCost(encode(0, 0), encode(5, 5), blocked, 40)).toBe(GRID_CELLS)
  })
  it('a blocked target cell is unreachable (you can never stand on a wall)', () => {
    const target = encode(3, 3)
    expect(bfsPathCost(encode(0, 0), target, new Set([target]), 20)).toBe(GRID_CELLS)
  })
})

// D125 — the MOB/PLAYER REPLAY path must ANIMATE a legal BFS route around walls & bodies (a mob was seen walking
// THROUGH holes/obstacles). `legal_move_path` is the display-path builder the fight replay uses (dungeon_store
// `emit_move`); it must NEVER emit a waypoint that is a hole/obstacle/out-of-bounds wall or an occupied body,
// while still reaching the real chain endpoint. D75: the walls are the STORED record fields (obstacles/holes on
// the dungeon), not a seed-derived twin — these scenarios pin them explicitly on a legacy 10×10 rect.
describe('dungeon-grid / legal_move_path (D125 — mob replay routes around holes/obstacles, never through them)', () => {
  const dungeon = {
    id: '0xdead',
    room_index: 0,
    grid_width: 10,
    grid_height: 10,
    escrow: [],
    mobs: [],
    obstacles: [encode(7, 6), encode(9, 7), encode(7, 5), encode(5, 2), encode(2, 7)],
    holes: [encode(9, 3), encode(6, 6)],
  }
  const g = dungeon_grid_of(dungeon)
  const walls = wallCells(g)

  it('the record grid carries the walls these scenarios rely on', () => {
    expect(g.width).toBe(10)
    expect(g.height).toBe(10)
    expect(g.obstacles).toEqual([encode(7, 6), encode(9, 7), encode(7, 5), encode(5, 2), encode(2, 7)])
    expect(g.holes).toEqual([encode(9, 3), encode(6, 6)])
  })

  it('an OBSTACLE directly between A→B forces a detour (never steps onto it)', () => {
    // (8,5)->(6,5): the straight manhattan line would step onto obstacle (7,5). The legal route bends around.
    const path = legal_move_path(dungeon, 'mob-0', encode(8, 5), encode(6, 5))
    expect(path.length).toBeGreaterThan(0)
    expect(path).not.toContain(encode(7, 5)) // never through the obstacle
    for (const c of path) expect(walls.has(c)).toBe(false) // NO waypoint is ever a wall
    expect(path[path.length - 1]).toBe(encode(6, 5)) // still reaches the real chain endpoint
    expect(bfsPath(encode(8, 5), encode(6, 5), walls, GRID_CELLS)).toEqual(path) // == the player's own BFS route
  })

  it('a HOLE is never a waypoint (hole + obstacle both on the straight line)', () => {
    // (8,6)->(4,6): the straight line crosses obstacle (7,6) AND hole (6,6). The legal route avoids BOTH.
    const path = legal_move_path(dungeon, 'mob-0', encode(8, 6), encode(4, 6))
    expect(path.length).toBeGreaterThan(0)
    expect(path).not.toContain(encode(6, 6)) // the hole is NEVER stepped on
    expect(path).not.toContain(encode(7, 6)) // nor the obstacle
    for (const c of path) expect(walls.has(c)).toBe(false)
    expect(path[path.length - 1]).toBe(encode(4, 6))
  })

  it('body-blocking: another living fighter on the straight line is routed around (mover never blocks ITSELF)', () => {
    // A mob (mob-0) parked on (7,4) blocks the clear row-4 corridor from (8,4)->(6,4); the moving PLAYER must
    // detour around its body, exactly like the contract's move_blocked_cells. Excluding by identity is proven by
    // the twin call where mob-0 is the MOVER: it excludes ITSELF, so its own body no longer blocks the route.
    const occ = {
      id: '0xoccupied',
      room_index: 0,
      grid_width: 10,
      grid_height: 10,
      escrow: [],
      mobs: [{ alive: true, cell: encode(7, 4) }],
    }
    const via_player = legal_move_path(occ, '0xPLAYER', encode(8, 4), encode(6, 4))
    expect(via_player.length).toBeGreaterThan(0)
    expect(via_player).not.toContain(encode(7, 4)) // player never walks through the mob's body
    expect(via_player[via_player.length - 1]).toBe(encode(6, 4))
    // the SAME mob moving through its own recorded cell excludes itself → the straight corridor is clear again.
    const self_move = legal_move_path(occ, 'mob-0', encode(8, 4), encode(6, 4))
    expect(self_move).toEqual([encode(7, 4), encode(6, 4)]) // straight, because mob-0 doesn't body-block mob-0
  })

  it('same start/target (or a self-only exclude) yields an empty path', () => {
    expect(legal_move_path(dungeon, 'mob-0', encode(3, 0), encode(3, 0))).toEqual([])
  })

  it('D75: an OFF-MASK cell is a wall for the replay route (¬shape_mask folds into the blocked set)', () => {
    // a masked record: 5×5 room with column x=2 carved off rows 1..4 — the only route (1,0)->(3,0) around the
    // carved gap is through the TOP row cell (2,0) which stays on-mask.
    const mask = new Set()
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) if (!(x === 2 && y >= 1)) mask.add(encode(x, y))
    const carved = {
      id: '0xcarved',
      room_index: 0,
      shape_mask: mask,
      grid_width: 5,
      grid_height: 5,
      obstacles: [],
      holes: [],
      start_cells_a: [encode(0, 0)],
      start_cells_b: [encode(4, 4)],
      escrow: [],
      mobs: [],
    }
    const route = legal_move_path(carved, '0xME', encode(1, 2), encode(3, 2))
    expect(route.length).toBeGreaterThan(0)
    for (const c of route) expect(mask.has(c)).toBe(true) // never a waypoint on the carved void
    expect(route).not.toContain(encode(2, 2)) // the carved cell on the straight line
    expect(route[route.length - 1]).toBe(encode(3, 2))
  })
})

describe('dungeon-grid / dungeon_blocked_cells — the `also_vacated` optimistic-death drop (walk where a mob just died)', () => {
  // Two LIVE mobs, no obstacles. A live mob body-blocks its cell; a cell listed in `also_vacated` (a cast-first
  // drafted kill the chain already applied before my move) must NOT block — exactly what lets the move-gate accept
  // a step onto a mob I killed THIS turn, mirroring `cast::move_blocked_cells` remasking over LIVING mobs only.
  const A = encode(4, 4)
  const B = encode(6, 4)
  const dungeon = { id: '0xdead', room_index: 0, grid_width: 10, grid_height: 10, escrow: [], mobs: [{ alive: true, cell: A }, { alive: true, cell: B }] }

  it('a LIVE mob blocks its cell; NO also_vacated ⇒ pure chain truth (both blocked)', () => {
    const base = dungeon_blocked_cells(dungeon, '0xME')
    expect(base.has(A)).toBe(true)
    expect(base.has(B)).toBe(true)
  })

  it('a cell in also_vacated is DROPPED (steppable) while the OTHER live mob still blocks', () => {
    const blocked = dungeon_blocked_cells(dungeon, '0xME', new Set([A]))
    expect(blocked.has(A)).toBe(false) // the drafted-killed mob no longer blocks → the move-gate accepts the step
    expect(blocked.has(B)).toBe(true) // the untouched live mob keeps body-blocking
  })

  it('an already-dead (chain) mob never blocks regardless of also_vacated', () => {
    const with_corpse = { ...dungeon, mobs: [{ alive: false, cell: A }, { alive: true, cell: B }] }
    expect(dungeon_blocked_cells(with_corpse, '0xME').has(A)).toBe(false)
  })

  it('excludes only the acting character when two living seats share one owner', () => {
    const seats = {
      ...dungeon,
      escrow: [
        { addr: '0xME', character: 'char-a', alive: true, cell: A },
        { addr: '0xME', character: 'char-b', alive: true, cell: B },
      ],
      mobs: [],
    }
    const blocked = dungeon_blocked_cells(seats, 'char-a')
    expect(blocked.has(A)).toBe(false)
    expect(blocked.has(B)).toBe(true)
  })
})
