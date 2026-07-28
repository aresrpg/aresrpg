// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { describe, expect, test } from 'bun:test'

import { engine_view } from '../src/project.js'
import { create_fight_store } from '../src/store.js'

const fight_id = '0x1493'
const character_id = '0xc1'
const width = 20
const encode = (x, y) => y * width + x
const player_cell = encode(1, 5)
const trap_b = encode(3, 5)
const trap_a = encode(4, 5)
const mob_cell = encode(5, 5)

const event = (kind, fields) => ({
  type: `0x0::fight_events::${kind}`,
  parsedJson: { fight: fight_id, ...fields },
})

const fight_object = {
  id: fight_id,
  status: 1,
  width,
  height: 19,
  participants: [
    {
      owner: '0xaaa',
      character: character_id,
      class: 'yajin',
      team: 0,
      ap: 9,
      mp: 6,
      base_ap: 9,
      base_mp: 6,
      hp: 50,
      max_hp: 50,
      cell: player_cell,
    },
  ],
  mobs: [{ template: '0xmob', hp: 100, max_hp: 100, cell: mob_cell, ap: 4, mp: 4, level: 1 }],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

const boot = () => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id,
    my_key: 'p0',
    ctx: { my_entity_id: character_id, beat_ctx: { grid_width: width } },
  })
  store.getState().input({ type: 'snapshot', fight: fight_object, version: 5 }, 1_000)
  return store
}

const place_trap = (store, intent_id, anchor, cells) =>
  store.getState().input(
    {
      type: 'predicted',
      basis_version: 6,
      intent_id,
      actions: [{ kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: anchor, ap_cost: 1 }],
      place_traps: cells,
    },
    1_100
  )

const visible_anchors = (store) =>
  store
    .getState()
    .my_traps.filter((trap) => !trap.gone)
    .map((trap) => trap.anchor)

const overlay_anchors = (store) =>
  store
    .getState()
    .my_traps.filter((trap) => !trap.gone || !trap.presented)
    .map((trap) => trap.anchor)

describe('#1493 trap projection folds individual trigger events', () => {
  test('trap A consumes at step k, overlapping trap B stays armed, then B consumes at step k+n', () => {
    const store = boot()
    place_trap(store, 'trap-a', trap_a, [trap_a])
    place_trap(store, 'trap-b', trap_b, [trap_b])

    store.getState().input(
      {
        type: 'receipt',
        version: 7,
        receipt: { events: [event('MobMoved', { idx: 0, to_cell: trap_b })] },
      },
      1_200
    )

    const trigger_beats = store
      .getState()
      .wave.flatMap((turn) =>
        turn.beats.flatMap((beat, index) =>
          beat.kind === 'trap_trigger' ? [{ beat, trigger_id: `wave:${turn.seq}:${index}` }] : []
        )
      )

    expect(trigger_beats.map(({ beat }) => beat.payload.trap_anchor)).toEqual([trap_a, trap_b])
    expect(store.getState().my_traps.map((trap) => trap.gone)).toEqual([true, true])
    expect(store.getState().my_traps.map((trap) => trap.triggered_at)).toEqual(['7:0:0', '7:0:1'])
    expect(overlay_anchors(store)).toEqual([trap_a, trap_b])
    expect(engine_view(store.getState()).trap_prims).toEqual([trap_a, trap_b])

    const trigger = ({ beat, trigger_id }) =>
      store.getState().input({
        type: 'trap_triggered',
        anchor: beat.payload.trap_anchor,
        cell: beat.payload.trap_cell,
        trigger_id,
      })

    trigger(trigger_beats[0])
    expect(overlay_anchors(store)).toEqual([trap_b])
    expect(engine_view(store.getState()).trap_prims).toEqual([trap_b])
    expect(engine_view(store.getState()).my_traps).toEqual([])

    trigger(trigger_beats[0]) // replay cannot present the next trap
    expect(overlay_anchors(store)).toEqual([trap_b])

    trigger(trigger_beats[1])
    expect(overlay_anchors(store)).toEqual([])
    expect(engine_view(store.getState()).trap_prims).toEqual([])
    expect(store.getState().my_traps.map((trap) => trap.presented_trigger_id)).toEqual(
      trigger_beats.map(({ trigger_id }) => trigger_id)
    )
  })

  test('end-turn events do not consume an un-walked trap', () => {
    const store = boot()
    place_trap(store, 'trap-b', trap_b, [trap_b])

    store.getState().input(
      {
        type: 'receipt',
        version: 7,
        receipt: {
          events: [
            event('TurnEnded', { is_mob: false, idx: 0 }),
            event('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 120_000 }),
          ],
        },
      },
      1_200
    )

    store.getState().input({ type: 'presented', seq: store.getState().wave_seq }, 1_300)
    expect(visible_anchors(store)).toEqual([trap_b])
    expect(overlay_anchors(store)).toEqual([trap_b])
    expect(engine_view(store.getState()).my_traps).toEqual([trap_b])
    expect(engine_view(store.getState()).trap_prims).toEqual([trap_b])
  })
})
