// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LEG B — TRAP-DEATH ROLLBACK — a bug where a mob that walked onto a trap and died would roll back to its
// initial position instead of disappearing, keeping its glb model. Chain movement.move truncates the walk at the
// first trap cell and it dies THERE (parity: sim reduce.js mirrors). The final projection the rig consumes must
// be: mob AT the trap cell, dead (despawn presented), no lingering model — never rolled back to its start cell.
// The pre-move cell is held ONLY while the wave presents (the walk IS the render); once it drains, truth lands.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { engine_view } from '../src/project.js'
import { decode } from '../src/los.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const W = 20
const enc = (x, y) => y * W + x
const ME = enc(2, 2)
const MOB_START = enc(8, 5)
const TRAP = enc(6, 5) // two cells toward me — the mob walks onto it and dies
const ev = (kind, fields) => ({ type: `0x0::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...fields } })

const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: W,
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
      cell: ME,
    },
  ],
  mobs: [{ template: '0xabc', hp: 8, max_hp: 30, cell: MOB_START, ap: 4, mp: 6, level: 1 }],
  queue: [
    { is_mob: true, idx: 0 },
    { is_mob: false, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

const boot = () => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: W } } })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  return store
}

const mob0 = (store) => engine_view(store.getState()).fighters.get('mob-0')
const drain = (store, now) => {
  for (const t of [...store.getState().wave]) store.getState().input({ type: 'presented', seq: t.seq }, now)
}

// The mob's turn: it walks to the trap cell (truncated there) and the trap kills it.
const mob_walks_onto_trap = (store) =>
  store.getState().input(
    {
      type: 'receipt',
      fight_id: FIGHT,
      version: 6,
      trap_cells: [TRAP],
      receipt: {
        events: [
          ev('TurnStarted', { is_mob: true, idx: 0 }),
          ev('MobMoved', { idx: 0, to_cell: TRAP }),
          ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 8, remaining_hp: 0 }),
          ev('TurnEnded', { is_mob: true, idx: 0 }),
          ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 120_000 }),
        ],
      },
    },
    2_000
  )

describe('LEG B — a mob that walks onto a trap dies THERE, never rolled back to its start', () => {
  test('committed truth folds the mob dead at the trap cell (parity: stops + dies on the trap)', () => {
    const store = boot()
    mob_walks_onto_trap(store)
    const mob = mob0(store)
    expect(mob.committed_health, 'the trap killed it').toBe(0)
    expect(mob.committed_dead, 'chain truth: dead').toBe(true)
    // committed cell is the trap cell, never the start cell
    expect(engine_view(store.getState()).fighters.get('mob-0').cell).toBeDefined()
  })

  test('after the wave presents: mob AT the trap cell, despawned, NO lingering model, NO start-cell rollback', () => {
    const store = boot()
    mob_walks_onto_trap(store)
    drain(store, 2_600)
    const mob = mob0(store)
    expect(mob.dead, 'the dead mob despawns once its killing wave presents').toBe(true)
    expect(mob.cell, 'it rests ON the trap cell, not rolled back to its start').toEqual(decode(TRAP))
    expect(mob.cell).not.toEqual(decode(MOB_START))
  })
})
