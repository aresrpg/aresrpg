// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2166 — a status carried by the journal ActionEffect door and the Fight.fx.statuses object door is one row.
// The fixture is captured wire data, decoded directly through both production doors; no encoder is allowed to
// manufacture the expectation the decoder is meant to prove.

import { expect, test } from 'bun:test'

import * as wire from '../src/core_wire.js'
import { read_fighter_statuses } from '../src/fight_status_snapshot.js'
import { engine_view } from '../src/project.js'
import { create_fight_store } from '../src/store.js'

import capture from './fixtures/status_decode_2166.json' with { type: 'json' }

const PKG = '0xpkg::fight_events::'

const fight_object = (statuses = []) => ({
  id: capture.fight,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xowner',
      character: capture.character,
      class: 'yajin',
      team: 0,
      hp: 50,
      max_hp: 50,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      cell: 105,
      ready: true,
    },
  ],
  mobs: [],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1,
  invisibility_statuses: statuses,
})

const event = (kind, data) => ({
  type: PKG + kind,
  parsedJson: { fight: capture.fight, ...data },
})

const boot = (statuses = []) => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: capture.fight,
    my_key: 'p0',
    ctx: { my_entity_id: capture.character, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input({ type: 'snapshot', fight: fight_object(statuses), version: 1 }, 1_000)
  return store
}

const rows = (store) => engine_view(store.getState()).fighters.get(capture.character).effects

test('#2166 captured status bytes decode to the identical row through object and journal doors', () => {
  expect(typeof wire.decode_status_row, 'the two doors must import one wire normalizer').toBe('function')
  const object_decoded = wire.decode_status_row(capture.status)
  const journal_decoded = wire.decode_status_row(capture.status.effect, {
    remaining_turns: capture.status.remaining_turns,
    source: capture.status.source,
  })
  expect(journal_decoded).toEqual(object_decoded)

  const [object_row] = read_fighter_statuses({ fx: { statuses: [capture.status] } })
  const object_store = boot([object_row])
  const journal_store = boot()
  journal_store.getState().input(
    {
      type: 'receipt',
      fight_id: capture.fight,
      version: 2,
      receipt: {
        events: [
          event('ActionStarted', capture.action_started),
          event('ActionEffect', { ...capture.action_effect, effect: capture.status.effect }),
        ],
      },
    },
    1_100
  )

  expect(rows(journal_store)).toEqual(rows(object_store))
})
