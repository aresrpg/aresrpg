// RED-FIRST regression: a spell armed during my turn must NOT survive into the next turn. `armed_spell_id` is a
// fight-session UI pick meaningful only on my turn; a stale one would CAST on the first click of a fresh turn
// (DungeonBoard casts an armed spell on a castable click — an unintended cast). The reducer derives it null
// whenever the turn is not mine. The gold multi-turn fight caught this: the harness arms a damage spell each turn
// but only casts when adjacent, so an arm-without-cast left the spell armed into the next turn's "no stale armed
// spell" assert (fight_mouse_helpers.ts:807).
import { describe, expect, test } from 'bun:test'

import { create_fight_store } from './store.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const FIGHT_OBJECT = {
  id: FIGHT,
  status: 3,
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
  mobs: [],
}
const turn_started_me = {
  type: '0x0::fight_events::TurnStarted',
  parsedJson: { fight: FIGHT, is_mob: false, idx: 0, deadline_ms: 9000 },
}
const turn_ended_me = {
  type: '0x0::fight_events::TurnEnded',
  parsedJson: { fight: FIGHT, is_mob: false, idx: 0 },
}

describe('turn-end disarm — armed_spell_id does not survive my turn', () => {
  test('a spell armed on my turn clears the instant my turn ends (no stale armed spell)', () => {
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR } })
    store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
    store.getState().input({ type: 'receipt', receipt: { events: [turn_started_me] }, version: 6 }, 2_000)
    store.getState().input({ type: 'arm', spell_id: 'ember_strike' })
    expect(store.getState().armed_spell_id, 'a spell arms during my turn').toBe('ember_strike')
    // my turn ends — the reducer must derive armed_spell_id null (it is not my turn anymore)
    store.getState().input({ type: 'receipt', receipt: { events: [turn_ended_me] }, version: 7 }, 3_000)
    expect(store.getState().armed_spell_id, 'armed must clear when my turn ends — no stale armed spell').toBeNull()
    // RIDER (advisor pass-24): armed must STAY null into my next turn — the old pick never resurrects
    store.getState().input({ type: 'receipt', receipt: { events: [turn_started_me] }, version: 8 }, 4_000)
    expect(store.getState().armed_spell_id, 'armed stays null at my next TurnStarted — no resurrection').toBeNull()
  })
})
