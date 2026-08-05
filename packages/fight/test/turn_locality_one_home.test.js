// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// #2228 — TURN LOCALITY HAS ONE DERIVATION. "Is this turn mine" is R1 (fold.js): the seat, resolved from my key
// OR — when the key is not stamped yet — from `ctx.my_entity_id` against the adopted roster. The turn bracket
// (#2209) asked the SAME question a second time in KEY space (`fighter_key(...) === String(my_key)`) with no
// resolver fallback, so a seat whose key is still null masked its OWN turn: the player's own cast stayed
// invisible to him until the closing row landed — exactly the self-invisibility the bracket exists to prevent
// for peers. Production opens every fight session with `my_key: null` (world-shell/dungeon_fight_shim.js) and
// leans on that same resolver, which is why R1 carries the fallback at all.
import { describe, expect, test } from 'bun:test'

import { display_state, presented_state } from '../src/fold.js'
import { create_fight_store } from '../src/store.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const event = (kind, fields) => ({
  type: `0x0::fight_events::${kind}`,
  parsedJson: { fight: FIGHT, ...fields },
})
const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: 100,
    },
  ],
  mobs: [{ template: '0xabc', hp: 30, max_hp: 30, cell: 105, ap: 4, mp: 3, level: 1 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1,
}
// MY OWN turn, still OPEN on the wire: no TurnEnded, so `hold_open_turn` keeps all three rows bracketed.
const MY_OPEN_TURN = [
  event('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 90_000 }),
  event('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 105 }),
  event('Hit', { victim_is_mob: true, victim_idx: 0, amount: 10, remaining_hp: 20 }),
]

const with_my_open_turn = () => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: null, // the production init shape — the seat is resolved, never supplied
    ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  store.getState().input({ type: 'receipt', receipt: { events: MY_OPEN_TURN }, version: 6 }, 2_000)
  return store.getState()
}

describe('#2228 · turn locality is derived once', () => {
  test('the open bracket holds nothing: my own turn is mine (positive control — key stamped)', () => {
    const state = with_my_open_turn()
    expect(state.wave_hold?.rows).toHaveLength(3) // the bracket really is open, else this test proves nothing
    expect(state.my_key).toBe('p0')
    expect(display_state(state).fighters?.m0?.hp).toBe(20)
  })

  test('an unstamped key resolves through the SAME seat fact — the bracket never masks my own turn', () => {
    const state = { ...with_my_open_turn(), my_key: null }
    // `ctx.my_entity_id` still names me and the adopted roster still seats me, so R1 calls this turn LOCAL.
    // The bracket must read that one fact, not re-derive locality from the (absent) key string.
    expect(display_state(state).fighters?.m0?.hp).toBe(20)
    expect(presented_state(state).fighters?.m0?.hp).toBe(20)
  })

  test("a peer's open bracket still masks — the hold is not simply disabled", () => {
    const state = { ...with_my_open_turn(), ctx: { ...with_my_open_turn().ctx, my_entity_id: '0xnope' }, my_key: null }
    expect(display_state(state).fighters?.m0?.hp).toBe(30)
  })
})
