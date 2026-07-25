// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// board_paint.test.ts / ground_probe — the viewport's whole decision surface, headless.
//
// What is proven here is what the mount would otherwise hide: the two start bands and the seat glows come
// from the DERIVED board and the reducer's own picks (never from the renderer's memory), an unrigged class
// resolves NO model so the S4 capsule stands in rather than another class's body, and the board never
// mounts on terrain that has not actually streamed.

import { describe, test, expect } from 'bun:test'

import { board_of } from './board'
import { cell_intent_of, class_body_url, setup_scene_of } from './board_paint'
import { board_mount_key, wait_for_ground, FALLBACK_SURFACE_Y, HIGH_SENTINEL } from './ground_probe.js'
import { INITIAL_SIMULATOR_STATE, reduce_simulator, type SimulatorState } from './reducer'

const SEED = 0xc81f3a92
const mob_name_of = (template_id: string) => template_id

const seated = (): SimulatorState => {
  const base = reduce_simulator(
    reduce_simulator(
      { ...INITIAL_SIMULATOR_STATE, seed: SEED },
      {
        type: 'character_added',
        class_id: 'senshi',
        name: 'KAELIS',
        male: true,
      }
    ),
    { type: 'character_added', class_id: 'iyashi', name: 'MIRA', male: false }
  )
  const board = board_of(base.seed, base.anchor_nonce)
  return [
    { type: 'character_placed' as const, cell: board.start_cells_a[0], id: 'sim_c1' },
    { type: 'character_placed' as const, cell: board.start_cells_a[1], id: 'sim_c2' },
    {
      type: 'mob_picked' as const,
      cell: board.start_cells_b[0],
      template_id: 'mob_gronk',
      level: 12,
      min_level: 10,
      max_level: 20,
    },
  ].reduce(reduce_simulator, base)
}

describe('the setup scene fold', () => {
  test('paints both start bands from the derived board — six ally, six enemy', () => {
    const state = seated()
    const board = board_of(state.seed, state.anchor_nonce)
    const scene = setup_scene_of(board, { ...state, mob_name_of })
    expect(scene.start_a.length).toBe(board.start_cells_a.length)
    expect(scene.start_b.length).toBe(board.start_cells_b.length)
    expect(scene.start_a[0]).toEqual({ x: board.start_cells_a[0] % 20, y: Math.floor(board.start_cells_a[0] / 20) })
  })

  test('one fighter per placement and per mob pick, each on its own seat', () => {
    const state = seated()
    const scene = setup_scene_of(board_of(state.seed, state.anchor_nonce), { ...state, mob_name_of })
    expect(scene.fighters.filter(({ kind }) => kind === 'player').map(({ id }) => id)).toEqual(['sim_c1', 'sim_c2'])
    expect(scene.fighters.filter(({ kind }) => kind === 'mob').length).toBe(1)
    expect(scene.ally_seats.length).toBe(2)
    expect(scene.enemy_seats.length).toBe(1)
  })

  test('an unrigged class resolves NO model — the S4 capsule stands in, never another class body', () => {
    // senshi ships a rig; iyashi does not (CHARACTER_MODELS) — the live game would substitute senshi here.
    expect(class_body_url('senshi', true)).toBeTruthy()
    expect(class_body_url('iyashi', false)).toBeUndefined()
    const state = seated()
    const scene = setup_scene_of(board_of(state.seed, state.anchor_nonce), { ...state, mob_name_of })
    const [kaelis, mira] = scene.fighters
    expect(kaelis.glb_variant).toBeTruthy()
    expect(mira.glb_variant).toBeUndefined()
  })

  test('a placement whose character was deleted paints nothing (the fold never seats a ghost)', () => {
    const state = reduce_simulator(seated(), { type: 'character_removed', id: 'sim_c1' })
    const scene = setup_scene_of(board_of(state.seed, state.anchor_nonce), { ...state, mob_name_of })
    expect(scene.fighters.filter(({ kind }) => kind === 'player').map(({ id }) => id)).toEqual(['sim_c2'])
  })

  test('an empty setup paints the bands and nothing else — a blank board is a legal state', () => {
    const board = board_of(SEED, 0)
    const scene = setup_scene_of(board, { ...INITIAL_SIMULATOR_STATE, mob_name_of })
    expect(scene.fighters).toEqual([])
    expect(scene.ally_seats).toEqual([])
    expect(scene.start_a.length).toBeGreaterThan(0)
  })
})

describe('what a cell click means', () => {
  test('an enemy-band cell opens the mob picker for that seat, occupied or not', () => {
    const state = seated()
    const board = board_of(state.seed, state.anchor_nonce)
    const [taken] = board.start_cells_b
    expect(cell_intent_of(board, state, taken)).toEqual({ type: 'mob_cell', cell: taken })
    const free = board.start_cells_b.at(3) as number
    expect(cell_intent_of(board, state, free)).toEqual({ type: 'mob_cell', cell: free })
  })

  test('an ally-band cell seats the FOCUSED character; the focused seat itself lifts it back off', () => {
    const state = { ...seated(), focus_id: 'sim_c1' }
    const board = board_of(state.seed, state.anchor_nonce)
    const free = board.start_cells_a.at(4) as number
    expect(cell_intent_of(board, state, free)).toEqual({ type: 'place', cell: free, id: 'sim_c1' })
    const own_seat = board.start_cells_a.at(0) as number // sim_c1 sits here
    expect(cell_intent_of(board, state, own_seat)).toEqual({ type: 'unplace', cell: own_seat })
    // another character's seat is a SWAP target, not an unplace
    const other_seat = board.start_cells_a.at(1) as number
    expect(cell_intent_of(board, state, other_seat)).toEqual({ type: 'place', cell: other_seat, id: 'sim_c1' })
  })

  test('with nothing focused an ally cell does nothing — the page says so instead of guessing', () => {
    const state = { ...seated(), focus_id: null }
    const board = board_of(state.seed, state.anchor_nonce)
    expect(cell_intent_of(board, state, board.start_cells_a.at(4) as number)).toBeNull()
  })

  test('a cell in neither band is not an interaction', () => {
    const state = seated()
    const board = board_of(state.seed, state.anchor_nonce)
    const off_band = [...Array(380).keys()].find(
      (cell) => !board.start_cells_a.includes(cell) && !board.start_cells_b.includes(cell)
    ) as number
    expect(cell_intent_of(board, state, off_band)).toBeNull()
  })
})

describe('the ground probe — never mount on terrain that has not streamed', () => {
  const drive = (
    reads: readonly (number | null)[],
    { top_air = true }: { top_air?: boolean } = {}
  ): Promise<number> => {
    let tick = 0
    let clock = 0
    return wait_for_ground({
      sample_block: (_x, y, _z) => (y === HIGH_SENTINEL && top_air ? 0 : 1),
      surface_at: () => reads[Math.min(tick, reads.length - 1)] ?? null,
      next_frame: async () => {
        tick += 1
        clock += 16
      },
      now: () => clock,
      x: 0,
      z: 0,
    })
  }

  test('a stable surface resolves its TOP FACE (surface + 1)', async () => {
    expect(await drive([127, 127, 127])).toBe(128)
  })

  test('an unstable column is NOT trusted until it repeats — the deep-pocket trap', async () => {
    // 32 is the too-early read the demo measured; the real surface settles at 127
    expect(await drive([32, 127, 100, 127, 127, 127])).toBe(128)
  })

  test('a solid top column is never read at all (the surface chunk has not arrived)', async () => {
    expect(await drive([127, 127, 127], { top_air: false })).toBe(FALLBACK_SURFACE_Y)
  })

  test('a ring that never resolves falls back to sea level — the board mounts, it never hangs', async () => {
    expect(await drive([null])).toBe(FALLBACK_SURFACE_Y)
  })
})

describe('the mount key', () => {
  test('the same board repaints (same key); a reroll re-streams (new key)', () => {
    expect(board_mount_key(board_of(SEED, 0))).toBe(board_mount_key(board_of(SEED, 0)))
    expect(board_mount_key(board_of(SEED, 1))).not.toBe(board_mount_key(board_of(SEED, 0)))
  })
})
