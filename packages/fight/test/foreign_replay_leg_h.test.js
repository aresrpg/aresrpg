// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LEG H — FOREIGN REPLAY DEAD ON THE PEER CLIENT — 2-account coop: a peer sees no replay for what other
// players are doing in the fight, including the mob wave that follows another player's turn.
// A peer's committed turn reaches this client ONLY as the poll's wholesale Fight
// OBJECT; foreign_replay_turns must DERIVE paced beats for BOTH a foreign player's move/cast AND the mob wave
// that follows, and the wholesale view must adopt AFTER that replay drains. This pins the unit path so a green
// run localizes the live gap (trigger/mount), and a red run names the dead gate.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { foreign_replay_turns } from '../src/fold.js'
import { board_state_from_fight } from '../src/board_state.js'

const FIGHT = '0xf1'
const P0 = '0xc0' // the OTHER player (the initiator / my peer)
const P1 = '0xc1' // ME — the peer client, seat 1, a co-FIGHTER (not a spectator)
const W = 20
const enc = (x, y) => y * W + x

const participant = (owner, character, cell) => ({
  owner,
  character,
  class: 'senshi',
  team: 0,
  ap: 6,
  mp: 3,
  base_ap: 6,
  base_mp: 3,
  hp: 50,
  max_hp: 50,
  cell,
})

const FIGHT_V5 = {
  id: FIGHT,
  status: 1,
  width: W,
  height: 19,
  participants: [participant('0xa0', P0, enc(2, 2)), participant('0xa1', P1, enc(3, 2))],
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: enc(8, 8), ap: 4, mp: 3, level: 1 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: false, idx: 1 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

// version 6: the OTHER player (P0) moved AND the mob took a hit + moved — the coop turn wave the peer must see.
const FIGHT_V6 = {
  ...FIGHT_V5,
  participants: [participant('0xa0', P0, enc(6, 5)), participant('0xa1', P1, enc(3, 2))],
  mobs: [{ template: '0xabc', hp: 18, max_hp: 30, cell: enc(7, 6), ap: 4, mp: 3, level: 1 }],
}

const boot_peer = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p1', ctx: { my_entity_id: P1, beat_ctx: { grid_width: W } } })
  store.getState().input({ type: 'snapshot', fight: FIGHT_V5, version: 5 }, 1_000)
  return store
}

describe('LEG H — a peer client paces foreign player + mob turns from the adoption diff', () => {
  test('the unit path yields paced non-local turns for a foreign move + a mob action', () => {
    const store = boot_peer()
    const draft = store.getState()
    const candidate = board_state_from_fight({ fight: FIGHT_V6, version: 6, mob_names: {} })
    const turns = foreign_replay_turns(draft, candidate, 6)
    expect(turns.length, 'a coop peer derives replay turns from the diff (never instant/invisible)').toBeGreaterThan(0)
    expect(
      turns.every((t) => !t.is_local),
      'every derived turn is a FOREIGN (paced) turn'
    ).toBe(true)
  })

  test('the store defers the wholesale adopt behind the replay (peer sees the beats, then truth lands)', () => {
    const store = boot_peer()
    store.getState().input({ type: 'snapshot', fight: FIGHT_V6, version: 6 }, 2_000)
    const s = store.getState()
    expect(s.wave.length, 'the peer client enqueues the foreign replay wave').toBeGreaterThan(0)
    expect(s.view_version, 'the wholesale view is deferred until the replay drains').toBe(5)
    expect(s.pending_snapshot, 'the fresher read waits behind the wave').toBeTruthy()
    // drain the replay → the deferred snapshot adopts
    for (const t of [...s.wave]) store.getState().input({ type: 'presented', seq: t.seq }, 2_500)
    expect(store.getState().view_version, 'after the replay drains the wholesale view adopts').toBe(6)
  })
})

// ── H-FIX — THE LIVE GATE: 2-account coop peers see NO replays — not player turns, not mob waves. The
// unit path above pre-sets my_key='p1'. The LIVE shim (init_dungeon_fight) sets my_key:NULL and resolves the seat
// LAZILY — and that resolution runs in the WHOLESALE ADOPT, which is AFTER the foreign_replay gate. So on the
// peer's FIRST foreign snapshot state.my_key is still null, the gate bails (my_seat < 0), and the peer's turn
// adopts INSTANTLY (never paced). The fix resolves my seat from the INCOMING candidate view inside the gate, so a
// non-initiator paces the replay exactly like the initiator, independent of when my_key was first adopted.
describe('LEG H-FIX — the live gate opens for a non-initiator whose seat resolves lazily', () => {
  test('a peer client whose my_key was never pre-resolved still paces the foreign replay (red: instant adopt)', () => {
    const store = create_fight_store()
    // LIVE init shape: my_key null; the seed carries NO my_entity_id yet (character_id not threaded on this read),
    // so the seat stays unresolved — exactly the window the joiner hits before the object read carries the roster.
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: null, ctx: { beat_ctx: { grid_width: W } } })
    store.getState().input({ type: 'snapshot', fight: FIGHT_V5, version: 5 }, 1_000)
    expect(store.getState().my_key, 'the seed without my_entity_id leaves my seat unresolved').toBeNull()
    // the peer commits; the poll now threads my_entity_id. Today the gate reads the still-null state.my_key and
    // instant-adopts; the fix resolves p1 from the incoming candidate view and paces the replay.
    store
      .getState()
      .input(
        { type: 'snapshot', fight: FIGHT_V6, version: 6, ctx: { my_entity_id: P1, beat_ctx: { grid_width: W } } },
        2_000
      )
    const s = store.getState()
    expect(s.wave.length, 'the peer replay paces — the live gate opened').toBeGreaterThan(0)
    expect(s.view_version, 'the wholesale adopt defers behind the replay (not instant)').toBe(5)
    expect(s.pending_snapshot?.version, 'the fresher read waits behind the wave').toBe(6)
  })
})
