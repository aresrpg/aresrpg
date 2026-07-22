// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #481 — a committed self-buff must enter the per-fighter status fold from either ingress. The action envelope
// carries the exact Effect row before Cast; ActionStarted supplies the target cell. Snapshot-only coverage hid the
// missing reducer arm, so badges/hover/invisibility and every mechanics consumer saw an empty status home.

import { describe, expect, test } from 'bun:test'

import * as SE from '../../sim/src/spell_effect.js'

import { engine_view } from './project.js'
import { committed_state, create_fight_store } from './store.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const START = 105
const PKG = '0xpkg::fight_events::'

const effect = (kind, over = {}) => ({
  kind,
  element: 255,
  value: 1,
  area_shape: SE.SHAPE_POINT,
  area_size: 0,
  target_filter: SE.TF_NOT_ENEMY,
  chance: 100,
  turns: 3,
  stat: 0,
  flags: 0,
  phase: SE.PHASE_ON_ENTER,
  ...over,
})

const effects = [
  effect(SE.K_ALTER_STAT, { stat: SE.STAT_RANGE }),
  effect(SE.K_GIVE_POINTS, { stat: SE.POINT_MP }),
  effect(SE.K_INVISIBILITY),
]

const rows = [
  {
    kind: 'ActionStarted',
    data: {
      fight: FIGHT,
      caster_is_mob: false,
      caster_idx: 0,
      turn_ordinal: '1',
      action_ordinal: '0',
      action_kind: 0,
      target_cell: START,
      ap_cost: 2,
      effect_count: effects.length,
    },
  },
  ...effects.map((row, effect_ordinal) => ({
    kind: 'ActionEffect',
    data: {
      fight: FIGHT,
      caster_is_mob: false,
      caster_idx: 0,
      turn_ordinal: '1',
      action_ordinal: '0',
      effect_ordinal,
      effect: row,
    },
  })),
  {
    kind: 'Cast',
    data: { fight: FIGHT, caster_is_mob: false, caster_idx: 0, target_cell: START },
  },
  {
    kind: 'ActionResolved',
    data: {
      fight: FIGHT,
      caster_is_mob: false,
      caster_idx: 0,
      turn_ordinal: '1',
      action_ordinal: '0',
      target_cell: START,
      effects,
      fumbled: false,
      returned: false,
    },
  },
  { kind: 'TurnEnded', data: { fight: FIGHT, is_mob: false, idx: 0 } },
]

const fight_object = {
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'yajin',
      team: 0,
      hp: 50,
      max_hp: 50,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      cell: START,
    },
  ],
  mobs: [],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  invisibility_statuses: [],
}

const receipt = () => ({
  type: 'receipt',
  fight_id: FIGHT,
  version: 2,
  receipt: {
    events: rows.map((row) => ({ type: PKG + row.kind, parsedJson: row.data })),
  },
})

const journal = () => ({
  type: 'journal',
  fight_id: FIGHT,
  page: {
    fight: FIGHT,
    journal_head: String(rows.length),
    events: rows.map((row, seq) => ({
      seq: String(seq),
      version: '2',
      kind: row.kind,
      data: row.data,
      digest: '0xbuff',
    })),
  },
})

const drive = (input) => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input({ type: 'snapshot', fight: fight_object, version: 1, journal_head: '0' }, 1_000)
  store.getState().input(input, 1_100)
  return store
}

describe('#481 self-buff action effects enter the fighter status fold', () => {
  for (const [source, input] of [
    ['receipt', receipt],
    ['journal', journal],
  ])
    test(`${source}: range, MP, and invisibility rows reach statuses and engine_view.effects`, () => {
      const store = drive(input())
      const { statuses } = committed_state(store.getState()).fighters.p0
      expect(statuses).toEqual(
        effects.map((row) => ({
          kind: row.kind,
          remaining_turns: row.turns - 1,
          element: row.element,
          value: row.value,
          stat: row.stat,
          chance: row.chance,
          flags: row.flags,
        }))
      )
      expect(engine_view(store.getState()).fighters.get(CHAR).effects).toEqual(
        statuses.map((row, id) => ({ id: `${row.kind}:${id}`, ...row }))
      )
      expect(committed_state(store.getState()).fighters.p0.invisible).toBe(true)
      expect(committed_state(store.getState()).action_contexts).toEqual({})
    })
})
