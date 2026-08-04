// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2162 — LIVE SSE rows and the journal walker are two deliveries to one admission/presentation door.
// The captured turn is driven through the real EventSource adapter one row at a time, then re-delivered as the
// journal page. Suppressing the stream proves the page remains a complete fallback rather than a vacuous dedupe.

import { expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { open_fight_stream } from '../../frontend/src/world-shell/fight_sse_adapter.js'

import capture from './fixtures/capsules/observer_2124_peer_turns.journal.json' with { type: 'json' }

const { fight: FIGHT, observer: OBSERVER, peer: PEER } = capture
const BEFORE = 964090809
const TURN = 964091521
const T0 = 2_000_000
const TURN_ROWS = capture.events.filter((row) => Number(row.version) === TURN)

const participant = (owner, character, cell, hp) => ({
  owner,
  character,
  class: 'warrior',
  team: 0,
  hp,
  max_hp: 50,
  ap: 12,
  mp: 3,
  base_ap: 12,
  base_mp: 3,
  cell,
  ready: true,
})

const fight_object = () => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [participant('0xa11ce', OBSERVER, 5, 0), participant('0xb0b', PEER, 27, 28)],
  group_template: '0xmob_t',
  group_base_ap: 6,
  group_base_mp: 3,
  mobs: [
    { template: '0xmob_t', level: 3, hp: 60, max_hp: 60, cell: 26, ap: 6, mp: 3 },
    { template: '0xmob_t', level: 3, hp: 60, max_hp: 60, cell: 65, ap: 6, mp: 3 },
  ],
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: [5, 27],
  start_cells_b: [],
  turn_ptr: 1,
  queue: [],
  turn_deadline_ms: T0 + 30_000,
  turn_entropy: T0 + 30_000,
  turn_ordinal: 17,
  placement_deadline_ms: 0,
  world_seed: null,
  spawn_id: null,
  last_action_ms: 0,
})

const observer_store = () => {
  const store = create_fight_store()
  store.getState().input(
    {
      type: 'init',
      fight_id: FIGHT,
      ctx: { my_entity_id: OBSERVER, address: '0xa11ce', beat_ctx: { grid_width: 20 } },
    },
    T0
  )
  store.getState().input({ type: 'snapshot', fight: fight_object(), version: BEFORE }, T0 + 50)
  return store
}

const page_message = () => ({
  type: 'journal',
  fight_id: FIGHT,
  batch: {
    fight_id: FIGHT,
    source: 'journal',
    head: String(TURN_ROWS.at(-1).seq),
    events: TURN_ROWS.map((row) => ({ ...row, seq: String(row.seq), version: String(row.version) })),
  },
})

const visible_shape = (wave) =>
  wave.flatMap((turn) =>
    turn.beats
      .filter((beat) => !['turn_start', 'turn_end', 'turn_skip', 'fight_end'].includes(beat.kind))
      .map((beat) => [String(turn.source_id), beat.kind])
  )

const EXPECTED_VISIBLE = [
  [PEER, 'cast'],
  ['mob-1', 'move'],
  ['mob-1', 'arrival'],
  ['mob-0', 'move'],
  ['mob-0', 'arrival'],
]

const fake_source = () => {
  const listeners = new Map()
  return {
    readyState: 1,
    addEventListener: (kind, listener) => listeners.set(kind, listener),
    emit: (row) => listeners.get('fight')?.({ data: JSON.stringify(row), lastEventId: `${row.version}:${row.seq}` }),
    close: () => {},
  }
}

test('#2162 live turn raises the admission cursor; its journal page owes zero re-presentations', () => {
  const store = observer_store()
  const source = fake_source()
  const close = open_fight_stream({
    fight_id: FIGHT,
    input: (message) => store.getState().input(message, T0 + 500),
    event_source_factory: () => source,
    base_url: 'https://rpc.test',
    install_deadline_belt: false,
    set_timeout: (fn) => ({ fn }),
    clear_timeout: () => {},
  })

  for (const row of TURN_ROWS) source.emit(row)
  expect(store.getState().core.inbox.presented_version, 'every played live row must first cross admit_events').toBe(
    TURN
  )
  expect(visible_shape(store.getState().wave)).toEqual(EXPECTED_VISIBLE)

  const live_wave = store.getState().wave
  store.getState().input(page_message(), T0 + 1_000)
  expect(store.getState().wave, 'the walker may not replay what the live door already presented').toEqual(live_wave)
  expect(store.getState().core.last_read.owed).toEqual([])
  expect(store.getState().core.last_read.changed).toEqual([])
  close()
})

test('#2162 with the stream suppressed, the journal page presents every visible beat exactly once', () => {
  const store = observer_store()
  store.getState().input(page_message(), T0 + 1_000)
  expect(visible_shape(store.getState().wave)).toEqual(EXPECTED_VISIBLE)
  expect(store.getState().core.inbox.presented_version).toBe(TURN)
})
