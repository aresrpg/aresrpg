// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PLACEMENT GHOSTS — the fold-state home for a PEER's uncommitted placement pick, broadcast p2p: picks
// aren't committed pre-start, so teammates SEE where others intend to stand. Mirrors my_traps_fold /
// my_glyphs_fold structurally: a durable per-store accumulator, GC'd in recompute (fold.js), projected through
// engine_view. Cosmetic ONLY — never part of canonical_state/state_hash (a lying ghost can't do anything;
// legality and the real commit stay chain-only).

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { engine_view } from '../src/project.js'
import { GHOST_STALE_MS } from '../src/fold.js'

const FIGHT = '0xghostfight'
const ALICE = '0xchar_alice' // me (seat 0)
const BOB = '0xchar_bob' // a peer (seat 1)
const W = 20
const enc = (x, y) => y * W + x
const A_CELL = enc(2, 2)
const B_CELL = enc(3, 2)
const PICK = enc(9, 9)

const ev = (kind, fields) => ({ type: `0x0::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...fields } })

const participant = (owner, character, cell) => ({
  owner,
  character,
  class: 'senshi',
  team: 0,
  hp: 50,
  max_hp: 50,
  ap: 6,
  mp: 3,
  base_ap: 6,
  base_mp: 3,
  cell,
  ready: false,
})

const FIGHT_OBJECT = {
  id: FIGHT,
  status: 0, // ENGINE_PLACEMENT
  width: W,
  height: 19,
  participants: [participant('0xowner_a', ALICE, A_CELL), participant('0xowner_b', BOB, B_CELL)],
  mobs: [],
  group_template: '0xgroup',
  group_base_ap: 6,
  group_base_mp: 3,
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: [A_CELL, B_CELL, PICK],
  start_cells_b: [],
  turn_ptr: 0,
  queue: [],
  turn_deadline_ms: 0,
  placement_deadline_ms: 90_000,
  world_seed: 1,
  spawn_id: 1,
}

const boot = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: ALICE, beat_ctx: { grid_width: W } } })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  return store
}

describe("placement_ghosts — the fold-state home for a peer's uncommitted placement pick", () => {
  test('a peer ghost input projects through engine_view.placement_ghosts', () => {
    const store = boot()
    store.getState().input({ type: 'placement_ghost', fight_id: FIGHT, character: BOB, cell: PICK }, 1_100)
    expect(engine_view(store.getState()).placement_ghosts).toEqual([{ character: BOB, cell: PICK }])
  })

  test('a committed Placed for that character SUPERSEDES (clears) its ghost', () => {
    const store = boot()
    store.getState().input({ type: 'placement_ghost', fight_id: FIGHT, character: BOB, cell: PICK }, 1_100)
    expect(engine_view(store.getState()).placement_ghosts.length).toBe(1)
    store
      .getState()
      .input(
        { type: 'receipt', version: 6, receipt: { events: [ev('Placed', { character: BOB, cell: PICK })] } },
        1_200
      )
    expect(engine_view(store.getState()).placement_ghosts).toEqual([])
  })

  test('a ghost past GHOST_STALE_MS expires', () => {
    const store = boot()
    store.getState().input({ type: 'placement_ghost', fight_id: FIGHT, character: BOB, cell: PICK }, 1_000)
    expect(engine_view(store.getState()).placement_ghosts.length).toBe(1)
    // any later input re-runs recompute's GC pass — a neutral ctx no-op proves the TIME floor alone retires it.
    store.getState().input({ type: 'ctx', ctx: {} }, 1_000 + GHOST_STALE_MS + 1)
    expect(engine_view(store.getState()).placement_ghosts).toEqual([])
  })

  test('my OWN character never becomes a ghost (I see my real pick, never a hint of it)', () => {
    const store = boot()
    store.getState().input({ type: 'placement_ghost', fight_id: FIGHT, character: ALICE, cell: PICK }, 1_100)
    expect(engine_view(store.getState()).placement_ghosts).toEqual([])
  })

  test('ghosts stop projecting the instant the fight leaves placement (fight start)', () => {
    const store = boot()
    store.getState().input({ type: 'placement_ghost', fight_id: FIGHT, character: BOB, cell: PICK }, 1_100)
    expect(engine_view(store.getState()).placement_ghosts.length).toBe(1)
    store.getState().input(
      {
        type: 'receipt',
        version: 6,
        receipt: { events: [ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 90_000 })] },
      },
      1_200
    )
    expect(engine_view(store.getState()).placement_ghosts).toEqual([])
  })

  test('a mismatched fight_id is refused at the identity gate (never adopted)', () => {
    const store = boot()
    store.getState().input({ type: 'placement_ghost', fight_id: '0xsomeotherfight', character: BOB, cell: PICK }, 1_100)
    expect(engine_view(store.getState()).placement_ghosts).toEqual([])
  })
})
