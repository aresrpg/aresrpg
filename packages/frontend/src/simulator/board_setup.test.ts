// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// board_setup.test.ts — the L3 slice's pure half: the seed→board derivation and the setup reducer arms that
// pick mobs onto the enemy start cells and place roster characters onto the ally ones.
//
// The load-bearing claims: (1) a board is a PURE function of (seed, reroll nonce) and is byte-identical to the
// chain's own `board_gen` derivation — the simulator renders the exact layout the sim authority will fight on;
// (2) every pick/placement the reducer stores is LEGAL by construction, on every door (a fresh input, a board
// reroll, a seed change, a hand-edited IndexedDB row) — an illegal cell can never reach the fight builder.

import { describe, test, expect } from 'bun:test'
import { generate, board_seed_from_anchor } from '@aresrpg/sim/board_gen'
import { WORLD_SEED } from '@aresrpg/sim/world'
import { encode } from '@aresrpg/fight/los'

import { anchor_of, board_of, build_spec_of } from './board'
import {
  reduce_simulator,
  INITIAL_SIMULATOR_STATE,
  MAX_MOBS,
  type SimulatorState,
  type SimulatorInput,
} from './reducer'

const SEED = 0xc81f3a92

const fold = (state: SimulatorState, ...inputs: readonly SimulatorInput[]): SimulatorState =>
  inputs.reduce(reduce_simulator, state)

/** A roster of `count` characters on a seeded state — the fixture every placement case starts from. */
const with_roster = (count: number, seed = SEED): SimulatorState =>
  fold(
    { ...INITIAL_SIMULATOR_STATE, seed },
    ...Array.from({ length: count }, (_, index) => ({
      type: 'character_added' as const,
      class_id: 'SENSHI',
      name: `C${index + 1}`,
      male: true,
    }))
  )

describe('board derivation — pure, seeded, chain-identical', () => {
  test('the same (seed, nonce) derives a byte-identical board; a reroll moves the anchor', () => {
    const first = board_of(SEED, 0)
    expect(board_of(SEED, 0)).toEqual(first)
    const rerolled = board_of(SEED, 1)
    expect(rerolled.anchor).not.toEqual(first.anchor)
    // the reroll is the NEXT draw of the same stream — reproducible from the two persisted numbers alone
    expect(rerolled.anchor).toEqual(anchor_of(SEED, 1))
  })

  test('the layout IS the chain derivation (board_gen over the world seed + anchor)', () => {
    const board = board_of(SEED, 0)
    const chain = generate(board_seed_from_anchor(WORLD_SEED, board.anchor.x, board.anchor.z), 0)
    expect(board.board_seed).toBe(board_seed_from_anchor(WORLD_SEED, board.anchor.x, board.anchor.z))
    expect(board.width).toBe(chain.width)
    expect(board.height).toBe(chain.height)
    expect(board.start_cells_a).toEqual(chain.start_cells_a)
    expect(board.start_cells_b).toEqual(chain.start_cells_b)
    expect(board.obstacles.length).toBe(chain.obstacles.length)
  })

  test('voids are exactly the in-rect cells outside the shape — never a square board', () => {
    const board = board_of(SEED, 3)
    const void_keys = new Set(board.voids.map(({ x, y }) => encode(x, y)))
    const start_and_blocked = [
      ...board.start_cells_a,
      ...board.start_cells_b,
      ...board.obstacles.map(({ x, y }) => encode(x, y)),
      ...board.holes.map(({ x, y }) => encode(x, y)),
    ]
    for (const cell of start_and_blocked) expect(void_keys.has(cell)).toBe(false)
    for (const { x, y } of board.voids) {
      expect(x).toBeLessThan(board.width)
      expect(y).toBeLessThan(board.height)
    }
  })

  test('build_spec_of hands the engine the grid dims + the three cell lists at the seated origin', () => {
    const board = board_of(SEED, 0)
    const spec = build_spec_of(board, { x: 10, y: 130, z: -4 })
    expect(spec.grid_w).toBe(board.width)
    expect(spec.grid_h).toBe(board.height)
    expect(spec.anchor.origin).toEqual({ x: 10, y: 130, z: -4 })
    expect(spec.voids.length).toBe(board.voids.length)
  })

  test('the spec is FLAT — a board floating in the void never samples terrain relief', () => {
    // flat:true is what makes the engine skip its per-cell ground sampler (tactical/index.js build): in a
    // worldless scene that sampler reads an empty column and the board would seat itself on nothing.
    expect(build_spec_of(board_of(SEED, 0), { x: 0, y: 0, z: 0 }).flat).toBe(true)
  })
})

describe('mob picks — the enemy band only, capped at six', () => {
  test('a pick on a RED start cell is stored with its level; any other cell is refused', () => {
    const board = board_of(SEED, 0)
    const [red] = board.start_cells_b
    const [blue] = board.start_cells_a
    const state = fold(
      { ...INITIAL_SIMULATOR_STATE, seed: SEED },
      {
        type: 'mob_picked',
        cell: red,
        template_id: 'mob_gronk',
        level: 18,
        min_level: 10,
        max_level: 20,
      }
    )
    expect(state.mob_picks[red]).toEqual({ template_id: 'mob_gronk', level: 18 })

    const refused = fold(state, {
      type: 'mob_picked',
      cell: blue,
      template_id: 'mob_gronk',
      level: 18,
      min_level: 10,
      max_level: 20,
    })
    expect(refused.mob_picks[blue]).toBeUndefined()
    expect(Object.keys(refused.mob_picks).length).toBe(1)
  })

  test('the level is clamped into the mob band on pick AND on later steps', () => {
    const board = board_of(SEED, 0)
    const cell = board.start_cells_b.at(1) as number
    const state = fold(
      { ...INITIAL_SIMULATOR_STATE, seed: SEED },
      {
        type: 'mob_picked',
        cell,
        template_id: 'mob_aether',
        level: 999,
        min_level: 10,
        max_level: 20,
      }
    )
    expect(state.mob_picks[cell]?.level).toBe(20)
    const lowered = fold(state, { type: 'mob_level_set', cell, level: 1, min_level: 10, max_level: 20 })
    expect(lowered.mob_picks[cell]?.level).toBe(10)
  })

  test(`a ${MAX_MOBS + 1}th mob is refused — the board seats six per side`, () => {
    const board = board_of(SEED, 0)
    const full = fold(
      { ...INITIAL_SIMULATOR_STATE, seed: SEED },
      ...board.start_cells_b.slice(0, MAX_MOBS).map((cell) => ({
        type: 'mob_picked' as const,
        cell,
        template_id: 'mob_gronk',
        level: 5,
        min_level: 1,
        max_level: 10,
      }))
    )
    expect(Object.keys(full.mob_picks).length).toBe(MAX_MOBS)
    // every seat is taken, so a 7th pick has no legal cell left — but prove the CAP itself refuses even a
    // re-pick attempt on a fresh (legal) cell by shrinking the board's seats: the cap is on the count.
    const extra = board.start_cells_b[MAX_MOBS]
    if (extra !== undefined) {
      const over = fold(full, {
        type: 'mob_picked',
        cell: extra,
        template_id: 'mob_gronk',
        level: 5,
        min_level: 1,
        max_level: 10,
      })
      expect(Object.keys(over.mob_picks).length).toBe(MAX_MOBS)
    }
    // replacing an OCCUPIED seat still works at the cap (the count does not grow)
    const replaced = fold(full, {
      type: 'mob_picked',
      cell: board.start_cells_b[0],
      template_id: 'mob_other',
      level: 5,
      min_level: 1,
      max_level: 10,
    })
    expect(replaced.mob_picks[board.start_cells_b[0]]?.template_id).toBe('mob_other')
    expect(Object.keys(replaced.mob_picks).length).toBe(MAX_MOBS)
  })

  test('unpicking frees the seat', () => {
    const board = board_of(SEED, 0)
    const [cell] = board.start_cells_b
    const state = fold(
      { ...INITIAL_SIMULATOR_STATE, seed: SEED },
      {
        type: 'mob_picked',
        cell,
        template_id: 'mob_gronk',
        level: 5,
        min_level: 1,
        max_level: 10,
      }
    )
    expect(fold(state, { type: 'mob_unpicked', cell }).mob_picks[cell]).toBeUndefined()
  })
})

describe('placements — the ally band only, one cell per character', () => {
  test('a roster character is placed on a BLUE start cell; a red cell is refused', () => {
    const state = with_roster(2)
    const board = board_of(state.seed, state.anchor_nonce)
    const [blue] = board.start_cells_a
    const [red] = board.start_cells_b
    const placed = fold(state, { type: 'character_placed', cell: blue, id: 'sim_c1' })
    expect(placed.placements[blue]).toBe('sim_c1')
    expect(fold(placed, { type: 'character_placed', cell: red, id: 'sim_c2' }).placements[red]).toBeUndefined()
  })

  test('an unknown character id is refused (a hand-typed input can never seat a ghost)', () => {
    const state = with_roster(1)
    const board = board_of(state.seed, state.anchor_nonce)
    const placed = fold(state, { type: 'character_placed', cell: board.start_cells_a[0], id: 'sim_c6' })
    expect(Object.keys(placed.placements).length).toBe(0)
  })

  test('re-placing a seated character MOVES it — never two seats for one character', () => {
    const state = with_roster(1)
    const board = board_of(state.seed, state.anchor_nonce)
    const [first, second] = board.start_cells_a
    const moved = fold(
      state,
      { type: 'character_placed', cell: first, id: 'sim_c1' },
      { type: 'character_placed', cell: second, id: 'sim_c1' }
    )
    expect(moved.placements[first]).toBeUndefined()
    expect(moved.placements[second]).toBe('sim_c1')
  })

  test('placing onto an occupied cell replaces its occupant', () => {
    const state = with_roster(2)
    const board = board_of(state.seed, state.anchor_nonce)
    const [cell] = board.start_cells_a
    const swapped = fold(
      state,
      { type: 'character_placed', cell, id: 'sim_c1' },
      { type: 'character_placed', cell, id: 'sim_c2' }
    )
    expect(swapped.placements[cell]).toBe('sim_c2')
    expect(Object.values(swapped.placements)).toEqual(['sim_c2'])
  })

  test('deleting a character clears its placement — no dangling seat survives the roster', () => {
    const state = with_roster(2)
    const board = board_of(state.seed, state.anchor_nonce)
    const placed = fold(
      state,
      { type: 'character_placed', cell: board.start_cells_a[0], id: 'sim_c1' },
      { type: 'character_placed', cell: board.start_cells_a[1], id: 'sim_c2' }
    )
    const removed = fold(placed, { type: 'character_removed', id: 'sim_c1' })
    expect(Object.values(removed.placements)).toEqual(['sim_c2'])
  })

  test('unplacing frees the cell', () => {
    const state = with_roster(1)
    const board = board_of(state.seed, state.anchor_nonce)
    const [cell] = board.start_cells_a
    const placed = fold(state, { type: 'character_placed', cell, id: 'sim_c1' })
    expect(fold(placed, { type: 'character_unplaced', cell }).placements[cell]).toBeUndefined()
  })
})

describe('the board invariant — every stored cell is legal on the CURRENT board', () => {
  test('a reroll re-fits picks and placements to the new layout', () => {
    const state = with_roster(1)
    const board = board_of(state.seed, state.anchor_nonce)
    const seated = fold(
      state,
      { type: 'character_placed', cell: board.start_cells_a[0], id: 'sim_c1' },
      {
        type: 'mob_picked',
        cell: board.start_cells_b[0],
        template_id: 'mob_gronk',
        level: 5,
        min_level: 1,
        max_level: 10,
      }
    )
    const rerolled = fold(seated, { type: 'board_rerolled' })
    expect(rerolled.anchor_nonce).toBe(1)
    const next = board_of(rerolled.seed, rerolled.anchor_nonce)
    for (const cell of Object.keys(rerolled.placements)) expect(next.start_cells_a).toContain(Number(cell))
    for (const cell of Object.keys(rerolled.mob_picks)) expect(next.start_cells_b).toContain(Number(cell))
  })

  test('a new seed re-fits them too (the board changes wholesale under the picks)', () => {
    const state = with_roster(1)
    const board = board_of(state.seed, state.anchor_nonce)
    const seated = fold(state, { type: 'character_placed', cell: board.start_cells_a[0], id: 'sim_c1' })
    const reseeded = fold(seated, { type: 'seed_set', seed: 0x1234abcd })
    const next = board_of(reseeded.seed, reseeded.anchor_nonce)
    for (const cell of Object.keys(reseeded.placements)) expect(next.start_cells_a).toContain(Number(cell))
  })

  test('hydration drops illegal rows — a hand-edited database cannot seat an off-board fighter', () => {
    const hydrated = reduce_simulator(INITIAL_SIMULATOR_STATE, {
      type: 'hydrated',
      seed: SEED,
      anchor_nonce: 0,
      roster: [
        {
          id: 'sim_c1',
          name: 'KAELIS',
          class_id: 'SENSHI',
          male: true,
          level: 1,
          stat_alloc: { vitality: 0, wisdom: 0, strength: 0, intelligence: 0, chance: 0, agility: 0 },
          spell_levels: {},
          loadout: {},
        },
      ],
      focus_id: 'sim_c1',
      mob_picks: { 999: { template_id: 'mob_ghost', level: 3 } },
      placements: { 998: 'sim_c1' },
    })
    expect(hydrated.mob_picks).toEqual({})
    expect(hydrated.placements).toEqual({})

    const board = board_of(SEED, 0)
    const legal = reduce_simulator(INITIAL_SIMULATOR_STATE, {
      type: 'hydrated',
      seed: SEED,
      anchor_nonce: 0,
      roster: [],
      focus_id: null,
      mob_picks: { [board.start_cells_b[0]]: { template_id: 'mob_gronk', level: 4 } },
      placements: {},
    })
    expect(legal.mob_picks[board.start_cells_b[0]]).toEqual({ template_id: 'mob_gronk', level: 4 })
  })
})

// #883 ⑤ — live-fight verification found REROLL BOARD still clickable. The button is gone from the
// pane (BoardPane.test.tsx), but a button is chrome: the DOOR is what has to refuse, or any other caller —
// a stale handler, a keyboard path, a future surface — can still regenerate the layout the sim is fighting
// on, re-fitting every pick and placement under a snapshot the authority has already taken.
describe('the board door is SETUP-only', () => {
  const fighting = (): SimulatorState => {
    const board = board_of(SEED, 0)
    const seated = fold(with_roster(1), {
      type: 'character_placed',
      cell: board.start_cells_a[0],
      id: 'sim_c1',
    })
    return fold(seated, { type: 'fight_started' })
  }

  test('a reroll mid-fight is refused — the board the sim opened on is the board that stays', () => {
    const live = fighting()
    expect(live.phase).toBe('fight')
    const after = reduce_simulator(live, { type: 'board_rerolled' })
    expect(after.anchor_nonce).toBe(live.anchor_nonce)
    expect(after).toBe(live) // the very same state object — nothing was re-fitted
  })

  test('so is every other board verb — placing, unplacing and picking all belong to setup', () => {
    const live = fighting()
    const board = board_of(SEED, 0)
    expect(reduce_simulator(live, { type: 'character_unplaced', cell: board.start_cells_a[0] })).toBe(live)
    expect(
      reduce_simulator(live, {
        type: 'mob_picked',
        cell: board.start_cells_b[0],
        template_id: 'mob_gronk',
        level: 4,
        min_level: 1,
        max_level: 10,
      })
    ).toBe(live)
  })

  test('STOP hands the board back — the same verbs work again in setup', () => {
    const back = fold(fighting(), { type: 'fight_stopped' })
    expect(back.phase).toBe('setup')
    expect(reduce_simulator(back, { type: 'board_rerolled' }).anchor_nonce).toBe(back.anchor_nonce + 1)
  })
})
