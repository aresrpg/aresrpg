// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2163 — a peer's status-only cast is still a presentation action. The committed status projection owns the
// badge; the receipt renderer owns the cast animation. Neither is conditional on a Hit row.

import { describe, expect, test } from 'bun:test'

import { fight_visible_view } from '../src/project.js'
import { create_fight_store } from '../src/store.js'

const FIGHT = '0xf2163'
const CASTER = '0xcaster'
const ALLY = '0xally'
const TARGET = 105

const event = (kind, fields) => ({
  type: `0x0::fight_events::${kind}`,
  parsedJson: { fight: FIGHT, ...fields },
})

const participant = (character, cell) => ({
  owner: character,
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
})

const fight = {
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [participant(CASTER, TARGET), participant(ALLY, TARGET + 1)],
  mobs: [],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: false, idx: 1 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

describe('#2163 — status-only cast emission for an ally observer', () => {
  test('the receipt emits one cast animation while the committed projection exposes the badge row', () => {
    const store = create_fight_store()
    store.getState().input({
      type: 'init',
      fight_id: FIGHT,
      my_key: 'p1',
      ctx: { my_entity_id: ALLY, beat_ctx: { grid_width: 20 } },
    })
    store.getState().input({ type: 'snapshot', fight, version: 1 }, 1_000)
    store.getState().input(
      {
        type: 'receipt',
        version: 2,
        receipt: {
          events: [
            event('ActionStarted', {
              caster_is_mob: false,
              caster_idx: 0,
              turn_ordinal: 1,
              action_ordinal: 0,
              target_cell: TARGET,
            }),
            event('ActionEffect', {
              caster_is_mob: false,
              caster_idx: 0,
              turn_ordinal: 1,
              action_ordinal: 0,
              effect_ordinal: 0,
              effect: {
                kind: 9,
                stat: 0,
                value: 32775,
                turns: 2,
                chance: 100,
                target_filter: 32,
                area_shape: 0,
                area_size: 0,
              },
            }),
            event('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: TARGET }),
            event('ActionResolved', {
              caster_is_mob: false,
              caster_idx: 0,
              turn_ordinal: 1,
              action_ordinal: 0,
              target_cell: TARGET,
              spell: '0xstatus-only',
            }),
          ],
        },
      },
      1_100
    )

    const cast_beats = store
      .getState()
      .wave.flatMap((turn) => turn.beats)
      .filter((beat) => beat.kind === 'cast')
    expect(cast_beats).toHaveLength(1)
    expect(cast_beats[0].payload).toMatchObject({ entity_id: CASTER, spell_id: '0xstatus-only' })
    expect(fight_visible_view(store.getState()).entities[CASTER].statuses.rows).toContainEqual(
      expect.objectContaining({ kind: 9, remaining_turns: 2, value: 7 })
    )
  })
})
