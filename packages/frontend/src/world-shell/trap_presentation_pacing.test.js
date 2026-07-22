// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST regression (#397): receipt truth retires a sprung trap immediately, but its marker is PRESENTATION
// state. During a paced mob turn the marker must survive the receipt/turn-start repaint and disappear only when
// the serial queue renders that trap's trigger beat. A removal with no trigger beat remains immediate.

import { describe, expect, test } from 'bun:test'
import { create_fight_store } from '@aresrpg/fight/store'
import { engine_view } from '@aresrpg/fight/project'

import { create_fight_render_queue } from './fight_render_queue.js'
import {
  empty_trap_presentation,
  trap_beat_id,
  trap_presentation_reduce,
  trap_trigger_beats,
} from './trap_presentation.js'

const FIGHT = '0xtrap-presentation'
const CHAR = '0xc1'
const GRID_WIDTH = 20
const ME = 100
const MOB = 105
const TRAP = 107
const encode = ({ x, y }) => y * GRID_WIDTH + x

const FIGHT_OBJECT = {
  id: FIGHT,
  width: GRID_WIDTH,
  height: 19,
  status: 1,
  participants: [
    {
      owner: '0xaaa',
      character: CHAR,
      class: 'senshi',
      team: 0,
      hp: 50,
      max_hp: 50,
      ap: 9,
      mp: 3,
      base_ap: 9,
      base_mp: 3,
      cell: ME,
    },
  ],
  mobs: [{ template: '0xabc', level: 1, hp: 20, max_hp: 20, cell: MOB, ap: 4, mp: 3 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

const event = (kind, fields) => ({ type: `0x0::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...fields } })

const TRAP_CASCADE = [
  event('TurnEnded', { is_mob: false, idx: 0 }),
  event('TurnStarted', { is_mob: true, idx: 0, deadline_ms: 0 }),
  event('MobMoved', { idx: 0, to_cell: TRAP }),
  event('Hit', { victim_is_mob: true, victim_idx: 0, amount: 8, remaining_hp: 12 }),
  event('TurnEnded', { is_mob: true, idx: 0 }),
  event('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 99_000 }),
]

const boot = () => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    my_key: 'p0',
    ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: GRID_WIDTH } },
  })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  store.getState().input(
    {
      type: 'predicted',
      basis_version: 6,
      intent_id: 'trap-1',
      actions: [{ kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: TRAP, ap_cost: 2 }],
      beats: [{ kind: 'cast', at: 0, duration: 100, payload: {} }],
      place_traps: [TRAP],
    },
    1_100
  )
  for (const turn of store.getState().wave) store.getState().input({ type: 'presented', seq: turn.seq }, 1_200)
  return store
}

const make_clock = () => {
  let now = 0
  return { now: () => now, sleep: async (ms) => void (now += ms) }
}

describe('trap marker presentation follows the serial trigger beat', () => {
  test('a mob-triggered trap stays visible at receipt/turn start, then vanishes with the queued trigger', async () => {
    const store = boot()
    let presentation = trap_presentation_reduce(empty_trap_presentation(), {
      type: 'observe',
      live_cells: engine_view(store.getState()).my_traps,
      trigger_beats: [],
    })
    expect(presentation.visible_cells).toEqual([TRAP])

    store.getState().input(
      {
        type: 'receipt',
        receipt: { events: TRAP_CASCADE },
        version: 6,
        trap_cells: [TRAP],
      },
      2_000
    )
    const core = store.getState()
    const mob_turn = core.wave.find((turn) => !turn.is_local)
    expect(engine_view(core).my_traps, 'outcome truth retires the trap immediately').toEqual([])
    expect(mob_turn.beats.some((beat) => beat.kind === 'trap_trigger')).toBe(true)

    presentation = trap_presentation_reduce(presentation, {
      type: 'observe',
      live_cells: engine_view(core).my_traps,
      trigger_beats: trap_trigger_beats(encode, core.wave),
    })
    expect(
      presentation.visible_cells,
      'the marker vanished at mob-turn START; it must remain visible until trap_trigger renders'
    ).toEqual([TRAP])

    const clock = make_clock()
    const queue = create_fight_render_queue(clock)
    const timeline = []
    await queue.enqueue_turn({
      source_turn: `wave:${mob_turn.seq}`,
      events: mob_turn.beats.map((beat, beat_index) => ({
        ...beat,
        render: () => {
          if (beat.kind === 'trap_trigger')
            presentation = trap_presentation_reduce(presentation, {
              type: 'trigger_presented',
              beat_id: trap_beat_id(mob_turn.seq, beat_index),
            })
          timeline.push({ kind: beat.kind, traps: [...presentation.visible_cells] })
        },
      })),
    })
    expect(timeline.find((row) => row.kind === 'move')?.traps).toEqual([TRAP])
    expect(timeline.find((row) => row.kind === 'trap_trigger')?.traps).toEqual([])

    store.getState().input({ type: 'presented', seq: mob_turn.seq }, 5_000)
    presentation = trap_presentation_reduce(presentation, {
      type: 'observe',
      live_cells: engine_view(store.getState()).my_traps,
      trigger_beats: trap_trigger_beats(encode, store.getState().wave),
    })
    expect(presentation.visible_cells, 'ack/reconcile must not resurrect the spent marker').toEqual([])

    presentation = trap_presentation_reduce(presentation, {
      type: 'trigger_presented',
      beat_id: trap_beat_id(
        mob_turn.seq,
        mob_turn.beats.findIndex((beat) => beat.kind === 'trap_trigger')
      ),
    })
    expect(presentation.visible_cells, 'a duplicate trigger beat changes no observed cell delta').toEqual([])
  })

  test('a removal with no queued trigger is presented immediately', () => {
    let presentation = trap_presentation_reduce(empty_trap_presentation(), {
      type: 'observe',
      live_cells: [TRAP],
      trigger_beats: [],
    })
    presentation = trap_presentation_reduce(presentation, {
      type: 'observe',
      live_cells: [],
      trigger_beats: [],
    })
    expect(presentation.visible_cells, 'rollback has no trigger beat to wait for').toEqual([])
  })

  test('the voxel adapter advances the presented transition inside the serial trigger closure', async () => {
    const source = await Bun.file(new URL('./voxel_fight_adapter.js', import.meta.url)).text()
    const trigger_start = source.indexOf("else if (spec.kind === 'trap_trigger')")
    const trigger_end = source.indexOf("else if (spec.kind === 'damage'", trigger_start)
    const trigger_branch = source.slice(trigger_start, trigger_end)
    const transition_index = trigger_branch.indexOf("type: 'trigger_presented'")
    const reconcile_index = trigger_branch.indexOf('reconcile()')
    const boom_index = trigger_branch.indexOf('play_trap_boom(payload)')

    expect(trigger_start, 'the serial trap-trigger render branch must exist').toBeGreaterThan(-1)
    expect(transition_index, 'the trigger closure must advance the observed presentation delta').toBeGreaterThan(-1)
    expect(reconcile_index, 'the trigger closure must repaint the marker transition').toBeGreaterThan(transition_index)
    expect(boom_index, 'marker removal must sit immediately before the trigger boom').toBeGreaterThan(reconcile_index)
    expect(source, 'trap paint must consume presented cells, never jump straight to outcome truth').toContain(
      'const traps = presented_traps'
    )
    expect(source, 'the presented marker signature must invalidate the paint memo at the trigger beat').toContain(
      'paint_key(result, fight, dungeon, replaying, busy, presented_traps)'
    )
  })
})
