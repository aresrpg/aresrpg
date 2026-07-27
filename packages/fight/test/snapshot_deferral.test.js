// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const event = (kind, fields) => ({
  type: `0x0::fight_events::${kind}`,
  parsedJson: { fight: FIGHT, ...fields },
})
const player = (over = {}) => ({
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
  ...over,
})
const mob = (cell, hp = 30) => ({ template: '0xabc', hp, max_hp: 30, cell, ap: 4, mp: 3, level: 1 })
const fight_object = (over = {}) => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [player()],
  mobs: [mob(105), mob(105)],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
    { is_mob: true, idx: 1 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1,
  ...over,
})
const CASCADE = [
  event('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 105 }),
  event('Hit', { victim_is_mob: true, victim_idx: 0, amount: 10, remaining_hp: 20 }),
  event('TurnEnded', { is_mob: false, idx: 0 }),
  event('TurnStarted', { is_mob: true, idx: 1, deadline_ms: 0 }),
  event('MobMoved', { idx: 1, to_cell: 107 }),
  event('Cast', { caster_is_mob: true, caster_idx: 1, target_cell: 100 }),
  event('Hit', { victim_is_mob: false, victim_idx: 0, amount: 7, remaining_hp: 43 }),
  event('TurnEnded', { is_mob: true, idx: 1 }),
  event('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 99_000 }),
]

describe('snapshot demoted to a checkpoint while a wave drains (M2b · ONE INGRESS)', () => {
  test('a fresher object read is a checkpoint — inert to the fold, never leapfrogging the draining wave', () => {
    const store = create_fight_store()
    store.getState().input({
      type: 'init',
      fight_id: FIGHT,
      my_key: 'p0',
      ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
    })
    store.getState().input({ type: 'snapshot', fight: fight_object(), version: 5 }, 1_000)
    store.getState().input({ type: 'receipt', receipt: { events: CASCADE }, version: 6 }, 2_000)
    const post_turn = fight_object({ participants: [player({ hp: 43 })], mobs: [mob(105, 20), mob(107)] })

    // M2b: the object read NEVER adopts mid-fight — the receipt's CASCADE is the canonical truth and its wave
    // animates undisturbed. The old deferral is deleted: there is nothing to stash, nothing to leapfrog.
    store.getState().input({ type: 'snapshot', fight: post_turn, version: 7 }, 2_500)
    expect(store.getState().view_version, 'the checkpoint contributes nothing to the fold').toBe(5)

    const mob_turn = store.getState().wave.find((turn) => turn.source_id === 'mob-1')
    store.getState().input({ type: 'presented', seq: mob_turn.seq }, 3_000)
    expect(store.getState().view_version, 'the base never re-adopts — canonical catch-up rides the journal').toBe(5)
  })
})
