// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { engine_view } from '../src/project.js'
import { committed_truth, create_fight_store } from '../src/store.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const PEER = '0xc2'
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
  mobs: [
    { template: '0xabc', hp: 30, max_hp: 30, cell: 105, ap: 4, mp: 3, level: 1 },
    { template: '0xabc', hp: 30, max_hp: 30, cell: 105, ap: 4, mp: 3, level: 1 },
  ],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
    { is_mob: true, idx: 1 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}
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
const PEER_HANDOFF_OBJECT = {
  ...FIGHT_OBJECT,
  participants: [participant('0xaaa', CHAR, 100), participant('0xbbb', PEER, 101)],
  mobs: [],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: false, idx: 1 },
  ],
}
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
const PEER_HANDOFF = [
  event('TurnEnded', { is_mob: false, idx: 0 }),
  event('TurnStarted', { is_mob: false, idx: 1, deadline_ms: 99_000 }),
  event('Cast', { caster_is_mob: false, caster_idx: 1, target_cell: 100 }),
  event('Hit', { victim_is_mob: false, victim_idx: 0, amount: 7, remaining_hp: 43 }),
]

const boot_handoff_client = () => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input({ type: 'snapshot', fight: PEER_HANDOFF_OBJECT, version: 5 }, 1_000)
  return store
}

describe('presentation actor projection', () => {
  test('the wave cursor is separate from the frozen chain-active actor', () => {
    const store = create_fight_store()
    store.getState().input({
      type: 'init',
      fight_id: FIGHT,
      my_key: 'p0',
      ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
    })
    store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
    store.getState().input({ type: 'receipt', receipt: { events: CASCADE }, version: 6 }, 2_000)

    const during = engine_view(store.getState())
    expect(during.presenting_entity_id).toBe('mob-1')
    expect(during.active_entity_id).toBe(CHAR)

    const mob_turn = store.getState().wave.find((turn) => turn.source_id === 'mob-1')
    store.getState().input({ type: 'presented', seq: mob_turn.seq }, 3_000)
    expect(engine_view(store.getState()).presenting_entity_id).toBeNull()
  })

  test('receipt pacing and tail-first journal delivery project the same chain-anchored owner', () => {
    const receipt_client = boot_handoff_client()
    receipt_client.getState().input({ type: 'receipt', receipt: { events: PEER_HANDOFF }, version: 6 }, 2_000)

    const journal_client = boot_handoff_client()
    const rows = PEER_HANDOFF.map((row, seq) => ({
      seq: String(seq),
      version: '6',
      kind: row.type.split('::').pop(),
      digest: '0xhandoff',
      data: row.parsedJson,
    }))
    const page = (events) => ({
      type: 'journal',
      fight_id: FIGHT,
      page: { fight: FIGHT, events, journal_head: String(rows.length) },
    })
    journal_client.getState().input(page(rows.slice(2)), 2_000)
    journal_client.getState().input(page(rows), 2_001)

    const receipt_state = receipt_client.getState()
    const journal_state = journal_client.getState()
    expect(committed_truth(receipt_state).active).toBe('p1')
    expect(committed_truth(journal_state).active).toBe('p1')
    expect(engine_view(receipt_state).presenting_entity_id).toBe(PEER)
    expect(engine_view(journal_state).presenting_entity_id).toBeNull()
    expect([engine_view(receipt_state).active_entity_id, engine_view(journal_state).active_entity_id]).toEqual([
      PEER,
      PEER,
    ])
  })
})
