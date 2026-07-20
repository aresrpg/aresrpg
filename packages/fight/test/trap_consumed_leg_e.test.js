// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// LEG E — CONSUMED TRAP RESURRECTED BY ADOPTION — placing a trap and pushing a mob onto it predicted correctly,
// but the chain's correction showed the trap back as armed even though it had already triggered. A trap that
// KILLS the mob it pushed onto must stay consumed: the receipt-proven death ON the
// trap cell is a detonation, exactly like a live force-stop landing. The bug (fold.js recompute `detonated`
// filtered `f.alive`): a DEAD victim on the trap cell was excluded from the detonated set — and `detonated` is now
// the SOLE retirement proof (the `superseded` version-bump proxy was removed in v1.12.34), so the trap resurrected.

import { describe, expect, test } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { engine_view } from '../src/project.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const W = 20
const enc = (x, y) => y * W + x
const ME = enc(5, 5)
const MOB = enc(7, 5)
const TRAP = enc(8, 5) // one cell behind the mob, in the push direction
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
      ap: 9,
      mp: 3,
      base_ap: 9,
      base_mp: 3,
      hp: 50,
      max_hp: 50,
      cell: ME,
    },
  ],
  mobs: [{ template: '0xabc', hp: 8, max_hp: 30, cell: MOB, ap: 4, mp: 3, level: 1 }],
  queue: [{ is_mob: false, idx: 0 }],
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

const place_trap = (store) =>
  store.getState().input(
    {
      type: 'predicted',
      basis_version: 6,
      intent_id: 'trap1',
      actions: [{ kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: TRAP, ap_cost: 2 }],
      beats: [{ kind: 'cast', at: 0, duration: 100, payload: {} }],
      place_traps: [TRAP],
    },
    1_100
  )

const drain = (store, now) => {
  for (const t of [...store.getState().wave]) store.getState().input({ type: 'presented', seq: t.seq }, now)
}

describe('LEG E — a trap that kills the pushed mob stays consumed on adoption', () => {
  test('receipt lands the mob DEAD on the trap → the trap stays gone (not resurrected)', () => {
    const store = boot()
    place_trap(store)
    expect(engine_view(store.getState()).my_traps, 'trap is placed').toEqual([TRAP])

    // The receipt of MY push turn: the mob is Displaced ONTO the trap and the trap KILLS it (Hit → 0).
    store.getState().input(
      {
        type: 'receipt',
        fight_id: FIGHT,
        version: 7,
        receipt: {
          events: [
            ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: MOB }),
            ev('Displaced', { target_is_mob: true, target_idx: 0, from_cell: MOB, to_cell: TRAP, kind: 1 }),
            ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 8, remaining_hp: 0 }),
          ],
        },
      },
      1_200
    )
    drain(store, 1_300) // present any masking wave so engine_view reads the committed fold

    const mob = engine_view(store.getState()).fighters.get('mob-0')
    expect(mob.committed_health, 'the trap killed the mob on-chain').toBe(0)
    expect(engine_view(store.getState()).my_traps, 'a fired trap must NOT be resurrected by adoption').toEqual([])
  })

  test('a later snapshot re-listing nothing keeps the fired trap gone (durable floor)', () => {
    const store = boot()
    place_trap(store)
    store.getState().input(
      {
        type: 'receipt',
        fight_id: FIGHT,
        version: 7,
        receipt: {
          events: [
            ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: MOB }),
            ev('Displaced', { target_is_mob: true, target_idx: 0, from_cell: MOB, to_cell: TRAP, kind: 1 }),
            ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 8, remaining_hp: 0 }),
          ],
        },
      },
      1_200
    )
    drain(store, 1_300)
    expect(engine_view(store.getState()).my_traps).toEqual([])
  })
})
