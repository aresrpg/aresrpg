// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIGHT ENGINE · overlay_intents.js — unit coverage of the renderer-neutral overlay SEMANTICS: the move-reachable
// set (dungeon BFS twin + world sim reach), the D113 cast-range set (Manhattan range + integer LOS edges), the
// D112 placement phase-gate, and the W4 impact-beat ordering/preempt contract. The live half (driven Playwright)
// proves the pixels; this proves the math is verdict-identical to the contract/DungeonBoard gates it mirrors.
import { describe, expect, it } from 'bun:test'
// fight-los is the shared math home; the test asserts overlay_intents stays verdict-identical to these gates
// (bfsReachable / bfsPath / lineOfSight) — the whole point of the extraction — so import it FIRST (import/order).
import { encode, GRID_W, bfsReachable, bfsPath, lineOfSight } from '@aresrpg/fight/los'

import {
  move_reachable_set,
  move_plan_dungeon,
  move_path_dungeon,
  cast_range_set_dungeon,
  cast_range_set_world,
  placement_active,
  placement_cells_by_team,
  on_board,
  create_impact_queue,
  create_pace_queue,
  MOB_TURN_MIN_MS,
  DEATH_BEAT_S,
  TRAP_BEAT_S,
  resolve_cell_paints,
} from './overlay_intents.js'

const c = (x, y) => ({ x, y })

describe('resolve_cell_paints — one base paint per cell', () => {
  it('target red wins when the same cell is also in targetable range', () => {
    const cell = encode(4, 4)
    expect(resolve_cell_paints({ in_range: [cell], target: [cell] })).toEqual([{ cell, paint: 'target' }])
  })

  it('LOS-blocked wins when the same in-range cell is not visible', () => {
    const cell = encode(6, 4)
    expect(resolve_cell_paints({ in_range: [cell], los_blocked: [cell] })).toEqual([{ cell, paint: 'los_blocked' }])
  })

  it('a steered movement path replaces the underlying movement-range cell', () => {
    const cell = encode(5, 4)
    expect(resolve_cell_paints({ movement: [cell], movement_path: [cell] })).toEqual([{ cell, paint: 'movement_path' }])
  })
})

describe('move_reachable_set — dungeon regime (bfsReachable twin)', () => {
  it('equals bfsReachable over the same blocked set (cell-for-cell parity with DungeonBoard.reachable)', () => {
    const subject = { cell: c(5, 5), mp: 3 }
    const blocked = new Set([encode(5, 4), encode(6, 5)]) // a wall N and E of the mover
    const got = move_reachable_set(subject, { mode: 'dungeon', blocked })
    const expected = new Set(bfsReachable(encode(5, 5), 3, blocked))
    expect([...got].sort((a, b) => a - b)).toEqual([...expected].sort((a, b) => a - b))
  })

  it('excludes the start cell (you do not "move" onto your own tile)', () => {
    const got = move_reachable_set({ cell: c(3, 3), mp: 2 }, { mode: 'dungeon', blocked: new Set() })
    expect(got.has(encode(3, 3))).toBe(false)
  })

  it('empty for a 0-MP subject (nowhere to move)', () => {
    expect(move_reachable_set({ cell: c(4, 4), mp: 0 }, { mode: 'dungeon', blocked: new Set() }).size).toBe(0)
  })

  it('mob MP range (D126b): a mob subject reaches exactly bfsReachable(mob.cell, mob.mp, blocked)', () => {
    // mob at (2,2) with mp 2, one wall body at (2,3) — the mob-hover MP range must equal the contract twin.
    const mob = { cell: c(2, 2), mp: 2 }
    const blocked = new Set([encode(2, 3)])
    const got = move_reachable_set(mob, { mode: 'dungeon', blocked })
    expect([...got].sort((a, b) => a - b)).toEqual(
      [...new Set(bfsReachable(encode(2, 2), 2, blocked))].sort((a, b) => a - b)
    )
    expect(got.has(encode(2, 3))).toBe(false) // the wall body is not reachable
  })
})

describe('move_reachable_set — world regime (sim reach)', () => {
  const is_walkable = ({ x, y }) => x >= 0 && x < GRID_W && y >= 0 && y < 10
  it('reaches the 4-connected diamond within MP, start excluded', () => {
    const got = move_reachable_set({ cell: c(5, 5), mp: 1 }, { mode: 'world', is_walkable, is_occupied: () => false })
    // exactly the 4 orthogonal neighbours at MP 1
    expect([...got].sort((a, b) => a - b)).toEqual(
      [encode(4, 5), encode(6, 5), encode(5, 4), encode(5, 6)].sort((a, b) => a - b)
    )
    expect(got.has(encode(5, 5))).toBe(false)
  })
  it('an occupied cell (not self) blocks the step onto it', () => {
    const occ = new Set([encode(6, 5)])
    const got = move_reachable_set(
      { cell: c(5, 5), mp: 1 },
      { mode: 'world', is_walkable, is_occupied: (cc) => occ.has(encode(cc.x, cc.y)) }
    )
    expect(got.has(encode(6, 5))).toBe(false)
  })
})

describe('move_path_dungeon — the preview path (== the MP commit charges)', () => {
  it('equals bfsPath over the same blocked set, start-exclusive', () => {
    const subject = { cell: c(0, 0) }
    const blocked = new Set()
    const target = c(2, 0)
    const got = move_path_dungeon(subject, target, { blocked, mp: 5 })
    expect(got).toEqual(bfsPath(encode(0, 0), encode(2, 0), blocked, 5))
    expect(got).not.toContain(encode(0, 0)) // start excluded
    expect(got[got.length - 1]).toBe(encode(2, 0)) // ends on the target
  })
  it('empty when the target is the start', () => {
    expect(move_path_dungeon({ cell: c(1, 1) }, c(1, 1), { blocked: new Set(), mp: 3 })).toEqual([])
  })
  it('empty when unreachable within MP (out of budget → honest refusal upstream)', () => {
    expect(move_path_dungeon({ cell: c(0, 0) }, c(5, 0), { blocked: new Set(), mp: 2 })).toEqual([])
  })
})

describe('#933 — a legal non-adjacent click carries one path + MP verdict', () => {
  it('plans the highlighted path and exact MP cost to a reachable cell', () => {
    const plan = move_plan_dungeon({ cell: c(0, 0) }, c(2, 0), { blocked: new Set(), mp: 5 })

    expect(plan).toEqual({
      path: [encode(1, 0), encode(2, 0)],
      mp_cost: 2,
      mp_left: 3,
    })
  })

  it('uses the existing blocker-aware BFS detour and charges every highlighted cell', () => {
    const blocker = encode(1, 0)
    const target = encode(2, 0)
    const plan = move_plan_dungeon({ cell: c(0, 0) }, c(2, 0), { blocked: new Set([blocker]), mp: 5 })

    expect(plan).not.toBeNull()
    expect(plan.path).not.toContain(blocker)
    expect(plan.path.at(-1)).toBe(target)
    expect(plan.mp_cost).toBe(plan.path.length)
    expect(plan.mp_cost).toBe(4)
    expect(plan.mp_left).toBe(1)
  })

  it('keeps self, blocked, and over-budget clicks silent', () => {
    const subject = { cell: c(0, 0) }

    expect(move_plan_dungeon(subject, c(0, 0), { blocked: new Set(), mp: 5 })).toBeNull()
    expect(move_plan_dungeon(subject, c(1, 0), { blocked: new Set([encode(1, 0)]), mp: 5 })).toBeNull()
    expect(move_plan_dungeon(subject, c(3, 0), { blocked: new Set(), mp: 2 })).toBeNull()
  })
})

describe('cast_range_set_dungeon — D113 range + integer LOS (mirrors DungeonBoard.castable)', () => {
  const grid = { width: 10, height: 10 }

  it('lights exactly the Manhattan ring [rmin,rmax] with clear LOS', () => {
    const caster = { cell: c(5, 5) }
    const got = cast_range_set_dungeon([1, 2], caster, grid, [])
    // every lit cell is within [1,2] manhattan; the caster's own cell is NOT lit (rmin 1).
    for (const cell of got) {
      const x = cell % GRID_W
      const y = (cell / GRID_W) | 0
      const d = Math.abs(x - 5) + Math.abs(y - 5)
      expect(d).toBeGreaterThanOrEqual(1)
      expect(d).toBeLessThanOrEqual(2)
    }
    expect(got.has(encode(5, 5))).toBe(false)
    // a representative in-ring cell IS present
    expect(got.has(encode(7, 5))).toBe(true) // distance 2 east
  })

  it('a folded +range status extends only a modifiable spell into the extra cell', () => {
    const caster = {
      cell: c(5, 5),
      effects: [{ kind: 9, stat: 6, value: 1, flags: 0, remaining_turns: 2 }],
    }
    const extra = encode(8, 5) // distance 3: one beyond the authored [1,2] maximum
    expect(cast_range_set_dungeon([1, 2], caster, grid, [], { modifiable_range: true }).has(extra)).toBe(true)
    expect(cast_range_set_dungeon([1, 2], caster, grid, [], { modifiable_range: false }).has(extra)).toBe(false)
  })

  it('rmax 0 (a self-buff) lights ONLY the caster cell', () => {
    const got = cast_range_set_dungeon([0, 0], { cell: c(4, 4) }, grid, [])
    expect([...got]).toEqual([encode(4, 4)])
  })

  it('an obstacle occludes cells behind it — parity with lineOfSight', () => {
    const caster = { cell: c(0, 5) }
    const obstacles = [encode(2, 5)] // a blocker two cells east on the sight row
    const got = cast_range_set_dungeon([1, 5], caster, grid, obstacles)
    // the cell directly behind the blocker (4,5) must be excluded iff lineOfSight says so — assert agreement.
    const behind = encode(4, 5)
    const los_clear = lineOfSight(encode(0, 5), behind, obstacles)
    expect(got.has(behind)).toBe(los_clear)
    // and the blocker cell itself (in range, LOS to it is trivially clear) is lit
    expect(got.has(encode(2, 5))).toBe(true)
  })

  it('null range defaults to [0,0] → the caster cell only (documented self-cast fallback)', () => {
    // matches the original overlay behavior: `range ?? [0,0]`, so a missing range paints just the self cell.
    expect([...cast_range_set_dungeon(null, { cell: c(1, 1) }, grid, [])]).toEqual([encode(1, 1)])
  })

  it('clips to the room rect (never lights a cell past width/height)', () => {
    const narrow = { width: 7, height: 7 }
    const got = cast_range_set_dungeon([1, 5], { cell: c(6, 6) }, narrow, [])
    for (const cell of got) {
      expect(cell % GRID_W).toBeLessThan(7)
      expect((cell / GRID_W) | 0).toBeLessThan(7)
    }
  })

  it('D75: clips to the stored shape_mask when the grid carries one (off-shape void is never washed)', () => {
    // a 5×5 rect with the (0,0) corner carved OFF the shape — a masked grid must never light the carved cell
    // even though it is inside the width×height rect and in range with clear LOS.
    const mask = new Set()
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) if (!(x === 0 && y === 0)) mask.add(encode(x, y))
    const grid = { width: 5, height: 5, shape_mask: mask }
    const got = cast_range_set_dungeon([1, 8], { cell: c(2, 2) }, grid, [])
    expect(got.has(encode(0, 0))).toBe(false) // carved off-shape — not a board cell
    expect(got.has(encode(1, 0))).toBe(true) // its on-shape neighbour at the same range IS washed
    for (const cell of got) expect(mask.has(cell)).toBe(true) // every washed cell is on the shape
  })

  it('free_cell (trap): drops every blocker cell — a mob body or a wall is never a legal trap cell', () => {
    const caster = { cell: c(5, 5) }
    const mob = encode(6, 5) // a living body 1 east — a normal spell targets it, a trap must NOT
    const wall = encode(5, 6) // a static obstacle 1 south
    const blockers = [mob, wall] // the union the dungeon passes as `obstacles`: obstacles ∪ living bodies
    const trap = cast_range_set_dungeon([1, 4], caster, grid, blockers, { free_cell: true, los: false })
    expect(trap.has(mob)).toBe(false) // rule: a trap cannot target a mob cell directly
    expect(trap.has(wall)).toBe(false) // traps land on NON-blocked cells
    expect(trap.has(encode(4, 5))).toBe(true) // a free, in-range cell IS a legal trap cell
    // the SAME geometry WITHOUT free_cell keeps the mob cell targetable (a normal offensive spell) — proving
    // the exclusion is free_cell-gated, not a blanket occupancy change.
    expect(cast_range_set_dungeon([1, 4], caster, grid, blockers, { los: false }).has(mob)).toBe(true)
  })

  it('trap_cells (1.29 no-stack): a cell anchoring MY live trap is never a legal trap target', () => {
    const caster = { cell: c(5, 5) }
    const my_trap = encode(6, 5) // my live trap 1 east — the chain aborts a second trap here (ECellAlreadyTrapped)
    const trap = cast_range_set_dungeon([1, 4], caster, grid, [], {
      free_cell: true,
      los: false,
      trap_cells: [my_trap],
    })
    expect(trap.has(my_trap)).toBe(false) // greyed — one trap per cell
    expect(trap.has(encode(4, 5))).toBe(true) // an untrapped free cell stays a legal target
    // WITHOUT trap_cells (a non-placing spell, or no live traps) the same cell stays aimable — the drop is
    // strictly opt-in by the caller (seed_cast_flags_of places_trap gates who passes it).
    expect(cast_range_set_dungeon([1, 4], caster, grid, [], { free_cell: true, los: false }).has(my_trap)).toBe(true)
    // a Set or array is accepted as-is (the consumers pass engine_view.my_traps — an encoded-cell array — directly)
    expect(
      cast_range_set_dungeon([1, 4], caster, grid, [], { los: false, trap_cells: new Set([my_trap]) }).has(my_trap)
    ).toBe(false)
  })

  // ── P1 self-cast wave: the spell_target::can_cast_at seed-flag twins (los / linear) ──────────────────────
  it('flags.los:false ignores line-of-sight — a cell behind a blocker is aimable (sl_line_of_sight off)', () => {
    const caster = { cell: c(0, 5) }
    const obstacles = [encode(2, 5)]
    const behind = encode(4, 5)
    // sanity: the default (LOS on) excludes it iff lineOfSight blocks; the no-LOS spell ALWAYS includes it.
    expect(lineOfSight(encode(0, 5), behind, obstacles)).toBe(false)
    expect(cast_range_set_dungeon([1, 5], caster, grid, obstacles).has(behind)).toBe(false)
    expect(cast_range_set_dungeon([1, 5], caster, grid, obstacles, { los: false }).has(behind)).toBe(true)
  })

  it('flags.linear:true keeps only orthogonally aligned cells (sl_line_launch twin)', () => {
    const got = cast_range_set_dungeon([1, 3], { cell: c(5, 5) }, grid, [], { linear: true })
    expect(got.size).toBeGreaterThan(0)
    for (const cell of got) {
      const x = cell % GRID_W
      const y = (cell / GRID_W) | 0
      expect(x === 5 || y === 5).toBe(true) // same row or column as the caster — never a diagonal aim
    }
    expect(got.has(encode(6, 6))).toBe(false) // in range (d=2) but off both axes
    expect(got.has(encode(5, 7))).toBe(true) // straight south, d=2
  })

  it('rmin 0 with flags lights the caster cell — THE self-cast gate (own cell counts as a legal aim)', () => {
    const got = cast_range_set_dungeon([0, 4], { cell: c(5, 5) }, grid, [], { los: true, linear: true })
    expect(got.has(encode(5, 5))).toBe(true)
  })
})

// ── D36 STALE-CAST REVALIDATION (DungeonBoard.flush_commit) — the flush-time fold that drops a staged cast whose
//    target the drafted moves / a co-op mob shift invalidated (the on-chain abort-114 EIllegalCast root). The fold
//    is `cast_range_set_dungeon(range, {cell: anchor}, grid, los_blockers).has(target)` anchored at the EXACT cell
//    the contract validates the cast from (pre-move when cast_first, else the post-move final cell). The fold lives
//    in DungeonBoard.jsx (not unit-importable — CSS/React imports), so these assert the twin it calls behaves as the
//    revalidation depends on: the SAME target flips legal→illegal purely by re-anchoring at the post-move cell. ──
describe('cast_range_set_dungeon — flush-time revalidation anchor (D36)', () => {
  const grid = { width: 10, height: 10 }

  it('a target legal from the chain cell goes ILLEGAL from the post-move cell (range) → dropped at flush', () => {
    const range = [1, 4]
    const chain_cell = c(0, 5)
    const post_move = c(4, 5) // the player drafted a 4-cell walk east before the deadline auto-commit
    const target = encode(0, 9) // distance 4 from the chain cell (legal at pick), distance 8 from post-move (illegal)
    expect(cast_range_set_dungeon(range, { cell: chain_cell }, grid, []).has(target)).toBe(true)
    expect(cast_range_set_dungeon(range, { cell: post_move }, grid, []).has(target)).toBe(false)
  })

  it('a co-op body that appears on the sight line invalidates an in-range target (LOS) → dropped at flush', () => {
    const range = [1, 5]
    const caster = c(0, 5)
    const behind = encode(4, 5)
    // clear line at pick time → legal; a mob steps onto (2,5) between draft and flush → LOS blocked → illegal.
    expect(cast_range_set_dungeon(range, { cell: caster }, grid, []).has(behind)).toBe(true)
    expect(cast_range_set_dungeon(range, { cell: caster }, grid, [encode(2, 5)]).has(behind)).toBe(false)
  })

  it('a still-in-range, still-clear target SURVIVES the re-anchor (a valid cast is never wrongly dropped)', () => {
    const range = [1, 4]
    const post_move = c(4, 5)
    const target = encode(5, 5) // distance 1 from the post-move cell, clear LOS → stays legal, commits
    expect(cast_range_set_dungeon(range, { cell: post_move }, grid, []).has(target)).toBe(true)
  })
})

describe('cast_range_set_world — sim targeting gate', () => {
  // a minimal fire-strike-like level: range [1,4], no linear/LOS/free-cell constraint.
  const level = { range: [1, 4], modifiable_range: false, linear: false, line_of_sight: false, free_cell: false }
  it('lights the Manhattan diamond [1,4] around the caster', () => {
    const got = cast_range_set_world(
      level,
      { cell: c(5, 5) },
      {
        blocks_los: () => false,
        is_occupied: () => false,
      }
    )
    expect(got.has(encode(5, 5))).toBe(false) // min_range 1 excludes self
    expect(got.has(encode(9, 5))).toBe(true) // distance 4 east
    expect(got.has(encode(5, 0))).toBe(false) // distance 5 north — out of range
  })
  it('inherits orthogonal-only linear targeting from the sim predicate', () => {
    const got = cast_range_set_world(
      { ...level, linear: true },
      { cell: c(5, 5) },
      {
        blocks_los: () => false,
        is_occupied: () => false,
      }
    )
    expect(got.has(encode(6, 6))).toBe(false) // in range, but diagonal
    expect(got.has(encode(8, 5))).toBe(true) // same row
    expect(got.has(encode(5, 2))).toBe(true) // same column
  })
  it('empty when no level (dungeon seed spell → the dungeon path is used instead)', () => {
    expect(
      cast_range_set_world(null, { cell: c(1, 1) }, { blocks_los: () => false, is_occupied: () => false }).size
    ).toBe(0)
  })
})

describe('placement_active — D112 phase gate', () => {
  it('dungeon + my seat: follows the phase-machine verdict (chain-ACTIVE clears the stale slice flag)', () => {
    const fight = { placement: true, winner: -1 } // slice flag STALE-true post-start
    // the machine says NOT placement (chain went ACTIVE) → the wash must NOT paint
    expect(placement_active(fight, { in_dungeon: true, has_my_seat: true, is_placement_phase: false })).toBe(false)
    // the machine says placement → paint
    expect(placement_active(fight, { in_dungeon: true, has_my_seat: true, is_placement_phase: true })).toBe(true)
  })
  it('world fight: uses the raw slice flag (placement && not won)', () => {
    expect(
      placement_active(
        { placement: true, winner: -1 },
        { in_dungeon: false, has_my_seat: false, is_placement_phase: false }
      )
    ).toBe(true)
    expect(
      placement_active(
        { placement: false, winner: -1 },
        { in_dungeon: false, has_my_seat: false, is_placement_phase: false }
      )
    ).toBe(false)
    expect(
      placement_active(
        { placement: true, winner: 0 },
        { in_dungeon: false, has_my_seat: false, is_placement_phase: false }
      )
    ).toBe(false)
  })
  it('seatless dungeon observer falls back to the raw slice flag', () => {
    expect(
      placement_active(
        { placement: true, winner: -1 },
        { in_dungeon: true, has_my_seat: false, is_placement_phase: false }
      )
    ).toBe(true)
  })
})

describe('placement_cells_by_team — the start-cell intent passthrough', () => {
  it("encodes each team's declared start cells", () => {
    const fight = { placement_cells: { 0: [c(1, 0), c(2, 0)], 1: [c(1, 6)] } }
    const got = placement_cells_by_team(fight)
    expect(got[0]).toEqual([encode(1, 0), encode(2, 0)])
    expect(got[1]).toEqual([encode(1, 6)])
  })
  it('empty arrays when a team has no cells', () => {
    expect(placement_cells_by_team({})).toEqual({ 0: [], 1: [] })
  })
})

describe('on_board — the arena-window clip guard', () => {
  it('true inside the GRID_W×GRID_H (20×19 canonical) window, false past any edge', () => {
    expect(on_board(c(0, 0))).toBe(true)
    expect(on_board(c(19, 18))).toBe(true)
    expect(on_board(c(-1, 5))).toBe(false)
    expect(on_board(c(20, 5))).toBe(false)
    expect(on_board(c(5, 19))).toBe(false)
  })
})

describe('create_impact_queue — W4 impact-beat ordering + D131 preempt', () => {
  it('fires a beat only once its delay has fully drained', () => {
    const q = create_impact_queue()
    const log = []
    q.schedule(0.5, () => log.push('a'))
    q.drain(0.2)
    expect(log).toEqual([]) // 0.3s left
    q.drain(0.2)
    expect(log).toEqual([]) // 0.1s left
    q.drain(0.2)
    expect(log).toEqual(['a']) // crossed 0
    expect(q.size()).toBe(0)
  })

  it('preserves FIFO order among same-frame-due beats (HP-beat law: releases in order)', () => {
    const q = create_impact_queue()
    const log = []
    q.schedule(0.1, () => log.push('first'))
    q.schedule(0.1, () => log.push('second'))
    q.schedule(0.1, () => log.push('third'))
    q.drain(0.2) // all three cross 0 the same frame
    expect(log).toEqual(['first', 'second', 'third'])
  })

  it('mixed delays fire in time order across frames', () => {
    const q = create_impact_queue()
    const log = []
    q.schedule(0.3, () => log.push('late'))
    q.schedule(0.1, () => log.push('early'))
    q.drain(0.15)
    expect(log).toEqual(['early']) // only the 0.1 one is due
    q.drain(0.2)
    expect(log).toEqual(['early', 'late'])
  })

  it('fast_forward (D131) fires ALL remaining beats now, oldest-first, then empties', () => {
    const q = create_impact_queue()
    const log = []
    q.schedule(0.9, () => log.push('anticipation'))
    q.schedule(1.4, () => log.push('impact'))
    q.fast_forward()
    expect(log).toEqual(['anticipation', 'impact']) // release order preserved, just instant
    expect(q.size()).toBe(0)
  })

  it('fast_forward on an empty queue is a no-op', () => {
    const q = create_impact_queue()
    expect(() => q.fast_forward()).not.toThrow()
    expect(q.size()).toBe(0)
  })

  it('clear drops all pending beats without firing them', () => {
    const q = create_impact_queue()
    const log = []
    q.schedule(0.1, () => log.push('x'))
    q.clear()
    q.drain(1)
    expect(log).toEqual([])
    expect(q.size()).toBe(0)
  })
})

describe('death/trap beat timing constants', () => {
  it('DEATH_BEAT_S is the SEEN-death linger; TRAP_BEAT_S leads damage', () => {
    expect(DEATH_BEAT_S).toBe(0.7)
    expect(TRAP_BEAT_S).toBe(0.28)
  })
})

// ── D19 MOB-TURN PACING (create_pace_queue) — the serial, ≥3s-floored runner mob playback drains through. Driven
//    on a FAKE clock: `now` reads a mutable ms counter; `sleep(ms)` advances it (the queue's floor is the only
//    place it's called, so advancing there models wall-time passing). This proves the timing contract
//    "mob turns must read ≥3s, one beat at a time, never an instant blur-through" (D19) rides on. ──
describe('create_pace_queue — D19 mob-turn pacing (fake clock)', () => {
  /** A controllable clock: `now()` reads `t`; `sleep(ms)` jumps `t` forward (a yield lets awaiters resume). */
  const make_clock = () => {
    let t = 0
    return {
      now: () => t,
      sleep: (ms) => {
        t += ms
        return Promise.resolve()
      },
      set: (ms) => {
        t = ms
      },
      get: () => t,
    }
  }

  it('MOB_TURN_MIN_MS is the 3s floor ("≥3s, its own beat")', () => {
    expect(MOB_TURN_MIN_MS).toBe(3000)
  })

  it('runs tasks SERIALLY — a later task never starts before the earlier one finished (no blur-through)', async () => {
    const clock = make_clock()
    const q = create_pace_queue({ min_ms: 3000, sleep: clock.sleep, now: clock.now })
    const order = []
    // three instant mob beats queued back-to-back (the solo-cascade burst).
    const a = q.run(() => void order.push('a-start'))
    const b = q.run(() => void order.push('b-start'))
    const c = q.run(() => void order.push('c-start'))
    await Promise.all([a, b, c])
    // strict serial order — b never interleaves ahead of a, c ahead of b.
    expect(order).toEqual(['a-start', 'b-start', 'c-start'])
  })

  it('FLOORS each instant beat to ≥3s of wall-time before the next starts', async () => {
    const clock = make_clock()
    const q = create_pace_queue({ min_ms: 3000, sleep: clock.sleep, now: clock.now })
    const starts = []
    q.run(() => void starts.push(clock.get())) // starts at t=0
    q.run(() => void starts.push(clock.get())) // must start at t≥3000 (prior slot floored)
    await q.run(() => void starts.push(clock.get())) // t≥6000
    expect(starts).toEqual([0, 3000, 6000])
  })

  it('RIDER C fight-start hold: a LEADING empty slot delays the opening mob beat one full beat behind the intro', async () => {
    // The adapter's [fight-start hold] ("wait for the fight to start instead of everything
    // parallel"): before the FIRST mob cascade it enqueues ONE empty paced slot — the intro becomes the queue's
    // first item (single-queue law) — THEN the real mob beat. This locks the required ordering:
    // board-spawn → intro/camera (the empty hold) → first delta, never a mob moving on top of the intro.
    const clock = make_clock()
    const q = create_pace_queue({ min_ms: 3000, sleep: clock.sleep, now: clock.now })
    const trace = []
    q.run(() => void trace.push({ ev: 'hold-beat', t: clock.get() })) // the empty intro-hold slot (floors to 3s)
    await q.run(() => void trace.push({ ev: 'first-delta', t: clock.get() })) // the opening mob's move/cast
    // the hold plays at t=0; the first mob delta only STARTS after the 3s hold floor — strictly [hold → delta], serial.
    expect(trace).toEqual([
      { ev: 'hold-beat', t: 0 },
      { ev: 'first-delta', t: 3000 },
    ])
  })

  it('the floor is a MINIMUM, never a fixed pad — a beat that already ran ≥3s adds nothing', async () => {
    const clock = make_clock()
    const q = create_pace_queue({ min_ms: 3000, sleep: clock.sleep, now: clock.now })
    const starts = []
    // a slow beat (its OWN animation ran 5s) followed by an instant one.
    q.run(async () => {
      starts.push(clock.get()) // t=0
      await clock.sleep(5000) // the real entity_move/entity_beat animation took 5s
    })
    await q.run(() => void starts.push(clock.get()))
    // the 2nd starts at 5000 (the slow beat's natural length), NOT 5000+3000 — the floor didn't pad it.
    expect(starts).toEqual([0, 5000])
  })

  it('a THROWING task never wedges the chain — the next paced beat still runs', async () => {
    const clock = make_clock()
    const q = create_pace_queue({ min_ms: 3000, sleep: clock.sleep, now: clock.now })
    let ran_after = false
    q.run(() => {
      throw new Error('beat blew up (a bad glb / missing entity)')
    }).catch(() => {})
    await q.run(() => {
      ran_after = true
    })
    expect(ran_after).toBe(true)
  })

  it('clear() drops the un-played BACKLOG (a torn-down fight) but the IN-FLIGHT slot still settles', async () => {
    const clock = make_clock()
    const q = create_pace_queue({ min_ms: 3000, sleep: clock.sleep, now: clock.now })
    const ran = []
    // slot 1: a slow beat that has already BEGUN (its body ran, it's mid-animation) when teardown hits.
    let release
    const gate = new Promise((r) => {
      release = r
    })
    const slot1 = q.run(async () => {
      ran.push('running')
      await gate // hold the in-flight beat open until we clear()
    })
    await Promise.resolve() // let slot 1's body START (it leaves `pending`, so clear can't cancel it)
    const dropped = q.run(() => void ran.push('backlog')) // slot 2 — still queued, never started
    q.clear() // teardown mid-cascade: drop the not-yet-started backlog
    release() // the in-flight beat finishes
    await Promise.all([slot1, dropped])
    // slot 1 (already running) SETTLED; slot 2's body was skipped (the board it would paint is gone).
    expect(ran).toEqual(['running'])
    expect(q.size()).toBe(0)
  })

  it('clear() BEFORE any slot starts drops the WHOLE backlog (a fight torn down between poll and playback)', async () => {
    const clock = make_clock()
    const q = create_pace_queue({ min_ms: 3000, sleep: clock.sleep, now: clock.now })
    const ran = []
    const a = q.run(() => void ran.push('a'))
    const b = q.run(() => void ran.push('b'))
    q.clear() // torn down before the microtask chain even ran → nothing should play
    await Promise.allSettled([a, b])
    expect(ran).toEqual([])
    expect(q.size()).toBe(0)
  })

  it('size() reflects the outstanding cascade (drains to 0 when every mob beat has played)', async () => {
    const clock = make_clock()
    const q = create_pace_queue({ min_ms: 100, sleep: clock.sleep, now: clock.now })
    const p1 = q.run(() => {})
    const p2 = q.run(() => {})
    expect(q.size()).toBe(2) // two mob beats queued
    await Promise.all([p1, p2])
    expect(q.size()).toBe(0) // cascade fully played out
  })
})
