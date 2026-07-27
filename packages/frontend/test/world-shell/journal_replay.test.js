// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Journal-fed viewers receive the exact same presentation grammar as the actor: a character path drives the
// walk clip, trap/damage beats reach their consumers, and every source turn drains in natural FIFO timing.

import { describe, expect, test } from 'bun:test'
import { local_move_beats } from '@aresrpg/fight/present'
import { engine_view } from '@aresrpg/fight/project'
import { create_fight_store } from '@aresrpg/fight/store'

import { create_fight_render_queue } from '../../src/world-shell/fight_render_queue.js'
import { journal_replay_messages } from '../../src/world-shell/journal_replay.js'
import { movement_gait } from '../../src/world-shell/voxel_fight_folds.js'

const FIGHT = '0xf1647'
const ALICE = '0xalice'
const BOB = '0xbob'
const TRAP_CELL = 42

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
  ready: true,
})

const fight_object = {
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [participant(ALICE, 21), participant(BOB, 22)],
  mobs: [{ template: '0xmob', level: 1, hp: 30, max_hp: 30, cell: 45, ap: 4, mp: 3 }],
  group_template: '0xmob',
  group_base_ap: 4,
  group_base_mp: 3,
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: [21, 22],
  start_cells_b: [45],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: false, idx: 1 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 1,
  turn_deadline_ms: 90_000,
  placement_deadline_ms: 0,
}

const row = (seq, kind, data, version = '11') => ({
  key: `${FIGHT}:${seq}`,
  fight_id: FIGHT,
  seq: String(seq),
  kind,
  data: { fight: FIGHT, ...data },
  digest: 'tx-peer-turn',
  version,
  source: 'journal',
})

// One canonical journal capsule: Bob enters a trap, then the inline mob turn walks and hits Alice. The trap Hit
// precedes Moved exactly as the chain emitter does; presentation must claim it into Bob's walk at the trap cell.
const REPLAY_CAPSULE = {
  fight_id: FIGHT,
  source: 'journal',
  head: '10',
  events: [
    row(0, 'TurnStarted', { is_mob: false, idx: 1, deadline_ms: '90' }),
    row(1, 'Hit', { victim_is_mob: false, victim_idx: 1, amount: '7', remaining_hp: '43' }),
    row(2, 'Moved', { character: BOB, to_cell: String(TRAP_CELL) }),
    row(3, 'TurnEnded', { is_mob: false, idx: 1 }),
    row(4, 'TurnStarted', { is_mob: true, idx: 0, deadline_ms: '91' }),
    row(5, 'MobMoved', { idx: 0, to_cell: '44' }),
    row(6, 'Hit', { victim_is_mob: false, victim_idx: 0, amount: '5', remaining_hp: '45' }),
    row(7, 'Cast', { caster_is_mob: true, caster_idx: 0, target_cell: '21' }),
    row(8, 'TurnEnded', { is_mob: true, idx: 0 }),
    row(9, 'TurnStarted', { is_mob: false, idx: 0, deadline_ms: '92' }),
  ],
}

const spectator_store = () => {
  const store = create_fight_store()
  store.getState().input({
    type: 'init',
    fight_id: FIGHT,
    ctx: { spectator: true, my_entity_id: null, beat_ctx: { grid_width: 20 } },
  })
  store.getState().input({ type: 'snapshot', fight: fight_object, version: 10 }, 1_000)
  return store
}

const fake_clock = () => {
  let now = 0
  return {
    now: () => now,
    sleep: async (ms) => void (now += ms),
    time: () => now,
  }
}

describe('journal replay presentation — spectator/partner pacing', () => {
  test('a spectator capsule uses the actor walk gait and carries trap + floating-number beats', () => {
    const store = spectator_store()
    const messages = journal_replay_messages({
      fight_id: FIGHT,
      batches: [REPLAY_CAPSULE],
      accepted_head: store.getState().accept_state.head,
      trap_cells: [TRAP_CELL],
    })

    expect(messages.map((message) => message.type)).toEqual(['receipt', 'journal'])
    for (const message of messages) store.getState().input(message, 2_000)

    const bob_turn = store.getState().wave.find((turn) => turn.source_id === BOB)
    expect(bob_turn).toBeDefined()
    expect(bob_turn.beats.map((beat) => beat.kind)).toEqual([
      'turn_start',
      'move',
      'arrival',
      'trap_trigger',
      'damage',
      'turn_end',
    ])

    const spectator_move = bob_turn.beats.find((beat) => beat.kind === 'move')
    const actor_move = local_move_beats({
      fight_id: FIGHT,
      character: BOB,
      to_cell: TRAP_CELL,
      path: spectator_move.payload.path,
    }).find((beat) => beat.kind === 'move')
    expect(spectator_move.payload.path).toEqual([{ x: 2, y: 2 }])
    expect(movement_gait(spectator_move.payload.path)).toBe('walk')
    expect(movement_gait(spectator_move.payload.path)).toBe(movement_gait(actor_move.payload.path))

    const trigger = bob_turn.beats.find((beat) => beat.kind === 'trap_trigger')
    const damage = bob_turn.beats.find((beat) => beat.kind === 'damage')
    expect(trigger).toMatchObject({ payload: { target_id: BOB, cell: { x: 2, y: 2 }, damage: 7 } })
    expect(damage).toMatchObject({ payload: { target_id: BOB, damage: 7, new_health: 43 } })
    expect(damage.at).toBe(trigger.at + trigger.duration)
    expect(store.getState().protocol_fault).toBeNull()
    expect(engine_view(store.getState()).fighters.get(BOB).cell).toEqual({ x: 2, y: 1 })
  })

  test('the replayed turns play serially from their own heads, never all at reconciliation time', async () => {
    const store = spectator_store()
    for (const message of journal_replay_messages({
      fight_id: FIGHT,
      batches: [REPLAY_CAPSULE],
      accepted_head: null,
      trap_cells: [TRAP_CELL],
    }))
      store.getState().input(message, 2_000)

    const turns = store.getState().wave.filter((turn) => !turn.is_local)
    expect(turns.map((turn) => turn.source_id)).toEqual([BOB, 'mob-0'])

    const clock = fake_clock()
    const fired = []
    const queue = create_fight_render_queue({ now: clock.now, sleep: clock.sleep })
    await Promise.all(
      turns.map((turn) =>
        queue.enqueue_turn({
          source_turn: turn.seq,
          events: turn.beats.map((beat) => ({
            ...beat,
            render: () => fired.push({ turn: turn.source_id, kind: beat.kind, at: clock.time() }),
          })),
        })
      )
    )

    const bob_move = fired.find((event) => event.turn === BOB && event.kind === 'move')
    const bob_trigger = fired.find((event) => event.turn === BOB && event.kind === 'trap_trigger')
    const bob_damage = fired.find((event) => event.turn === BOB && event.kind === 'damage')
    const mob_move = fired.find((event) => event.turn === 'mob-0' && event.kind === 'move')
    expect(bob_move.at).toBe(0)
    expect(bob_trigger.at).toBeGreaterThan(bob_move.at)
    expect(bob_damage.at).toBeGreaterThan(bob_trigger.at)
    expect(mob_move.at).toBe(bob_turn_duration(turns))
    expect(clock.time()).toBe(turns.reduce((sum, turn) => sum + turn.duration, 0))
  })
})

const bob_turn_duration = (turns) => turns.find((turn) => turn.source_id === BOB).duration
