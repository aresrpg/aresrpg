// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2164 — one collapsed walk can fire several traps. Each trigger beat retires its own sprite, including when
// the final trigger kills the mover and the chain emits the Hit rows before the destination-only MobMoved row.

import { describe, expect, test } from 'bun:test'

import { engine_view } from '../src/project.js'
import { create_fight_store } from '../src/store.js'

const FIGHT = '0xf2164'
const PLAYER = '0xplayer'
const W = 20
const enc = (x, y) => y * W + x
const PLAYER_CELL = enc(2, 5)
const MOB_START = enc(9, 5)
const LANDING = enc(4, 5)
const TRAPS = [enc(8, 5), enc(7, 5), enc(6, 5)]

const event = (kind, fields) => ({
  type: `0x0::fight_events::${kind}`,
  parsedJson: { fight: FIGHT, ...fields },
})

const fight = {
  id: FIGHT,
  status: 1,
  width: W,
  height: 19,
  participants: [
    {
      owner: PLAYER,
      character: PLAYER,
      class: 'senshi',
      team: 0,
      hp: 50,
      max_hp: 50,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      cell: PLAYER_CELL,
    },
  ],
  mobs: [{ template: '0xmob', hp: 15, max_hp: 15, cell: MOB_START, ap: 4, mp: 6, level: 1 }],
  queue: [
    { is_mob: true, idx: 0 },
    { is_mob: false, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

const chain_traps = TRAPS.map((anchor) => ({ anchor, owner_team: 0, cells: [anchor] }))

describe('#2164 — every trap trigger cleans up its own sprite', () => {
  test('three triggers, one mover, lethal final hit leaves zero spent sprites', () => {
    const store = create_fight_store()
    store.getState().input({
      type: 'init',
      fight_id: FIGHT,
      my_key: 'p0',
      ctx: { my_entity_id: PLAYER, beat_ctx: { grid_width: W } },
    })
    store.getState().input(
      {
        type: 'snapshot',
        fight,
        version: 1,
        ctx: { chain_traps, chain_traps_version: 1 },
      },
      1_000
    )
    store.getState().input(
      {
        type: 'receipt',
        version: 2,
        receipt: {
          events: [
            event('Hit', { victim_is_mob: true, victim_idx: 0, amount: 5, remaining_hp: 10 }),
            event('Hit', { victim_is_mob: true, victim_idx: 0, amount: 5, remaining_hp: 5 }),
            event('Hit', { victim_is_mob: true, victim_idx: 0, amount: 5, remaining_hp: 0 }),
            event('MobMoved', { idx: 0, to_cell: LANDING }),
          ],
        },
      },
      1_100
    )

    const triggers = store
      .getState()
      .wave.flatMap((turn) => turn.beats.map((beat, index) => ({ beat, turn, index })))
      .filter(({ beat }) => beat.kind === 'trap_trigger')
    expect(triggers.map(({ beat }) => beat.payload.trap_anchor)).toEqual(TRAPS)
    expect(engine_view(store.getState()).trap_prims).toEqual(TRAPS)

    for (const [trigger, expected] of triggers.map((row, index) => [row, TRAPS.slice(index + 1)])) {
      const { beat, turn, index } = trigger
      store.getState().input({
        type: 'trap_triggered',
        anchor: beat.payload.trap_anchor,
        cell: beat.payload.trap_cell,
        trigger_id: `wave:${turn.seq}:${index}`,
      })
      expect(engine_view(store.getState()).trap_prims).toEqual(expected)
    }
  })
})
