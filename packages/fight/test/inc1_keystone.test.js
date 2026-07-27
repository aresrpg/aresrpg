// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WAVE-A V3 (VIOLATION_REGISTER V3, seat §5d): the equal-version compare-adopt (the old "keystone #3") is DELETED.
// The monotonic gate is now ABSOLUTE — vN ≤ canonical ⇒ DISCARD ENTIRELY, regardless of content, no re-adopt, no
// divergence log. The sticky-stale case it patched is handled at the SOURCE: RECEIPT is the one-way floor (V9) and
// a fact a thinner adopt OMITS is HELD by V2's omission-semantics — never recovered by re-adopting a competitor.
// The SIMDRIVE no-rollback protection SURVIVES (tests 2/3, unchanged): an equal/older read is discarded regardless
// of content. These now lock the ABSENCE of the re-adopt. History of the deleted mechanism: git show e9ce8071.
import { describe, test, expect } from 'bun:test'

import { create_fight_store } from '../src/store.js'
import { engine_view } from '../src/project.js'

const FIGHT = '0xf1'
const ME = '0xchar'
const T0 = 1_000
const ev = (kind, json) => ({ type: `0xp::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...json } })

const fight_object = ({ mob_hp = 20, my_hp = 50 } = {}) => ({
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    {
      owner: '0xa',
      character: ME,
      class: 'w',
      team: 0,
      hp: my_hp,
      max_hp: 50,
      ap: 6,
      mp: 3,
      base_ap: 6,
      base_mp: 3,
      cell: 10,
      ready: true,
    },
  ],
  mobs: [{ template: '0xm', level: 1, hp: mob_hp, max_hp: 20, cell: 20, ap: 4, mp: 3 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1,
  last_action_ms: 0,
  obstacles: [],
  holes: [],
  shape_mask: [],
  start_cells_a: [10],
  start_cells_b: [],
})

const boot = () => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT, ctx: { my_entity_id: ME, beat_ctx: { grid_width: 20 } } }, T0)
  store.getState().input({ type: 'snapshot', fight: fight_object(), version: 5 }, T0)
  return store
}
const my_cast = () => [
  ev('Cast', { caster_is_mob: false, caster_idx: 0, target_cell: 20 }),
  ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 8, remaining_hp: 12, caster_is_mob: false, caster_idx: 0 }),
]

describe('WAVE-A V3 — equal-version snapshot is discarded (keystone #3 deleted)', () => {
  test('a DIVERGENT equal-version object is DISCARDED — the receipt floor holds (no re-adopt, no log)', () => {
    const store = boot()
    store.getState().input({ type: 'receipt', receipt: { events: my_cast() }, version: 6 }, T0 + 100)
    expect(engine_view(store.getState()).fighters.get('mob-0').health).toBe(12)
    expect(store.getState().applied_version).toBe(6)
    // the equal-version (v6) OBJECT disagrees (says 8). Under the ABSOLUTE monotonic gate it is DISCARDED, never
    // re-adopted: RECEIPT is the one-way floor (V9), so the receipt-proven 12 stands; no divergence is logged.
    store.getState().input({ type: 'snapshot', fight: fight_object({ mob_hp: 8 }), version: 6 }, T0 + 200)
    expect(engine_view(store.getState()).fighters.get('mob-0').health).toBe(12) // receipt floor holds — discarded
    expect(store.getState().view_version).toBe(5) // NOT re-adopted
    expect(store.getState().divergence).toBeNull() // the compare-adopt is gone — nothing logged
  })

  test('an equal-version re-read at an already-folded version is INERT — the checkpoint never rolls back (M2b)', () => {
    const store = boot() // snapshot v5 bootstrap
    // fold the mob to 12 at v6 through the ONE canonical door (the receipt) — under M2b authoritative state never
    // comes from a re-adopted object read.
    store.getState().input({ type: 'receipt', receipt: { events: my_cast() }, version: 6 }, T0 + 100)
    expect(engine_view(store.getState()).fighters.get('mob-0').health).toBe(12)
    // a torn/stale OBJECT re-read at v6 shows the OLD mob hp — the checkpoint is INERT (it never adopts), so there
    // is no rollback: the receipt-proven 12 stands (the SIMDRIVE no-rollback law, now structural).
    store.getState().input({ type: 'snapshot', fight: fight_object({ mob_hp: 20 }), version: 6 }, T0 + 200)
    expect(engine_view(store.getState()).fighters.get('mob-0').health).toBe(12) // held — no rollback
    expect(store.getState().view_version).toBe(5) // the base is never re-adopted mid-fight
    expect(store.getState().divergence).toBeNull()
  })

  test('a MATCHING equal-version object is discarded (no adoption, no divergence)', () => {
    const store = boot()
    store.getState().input({ type: 'receipt', receipt: { events: my_cast() }, version: 6 }, T0 + 100)
    store.getState().input({ type: 'snapshot', fight: fight_object({ mob_hp: 12 }), version: 6 }, T0 + 200) // == the fold
    expect(store.getState().divergence).toBeNull()
    expect(store.getState().view_version).toBe(5) // the view was NOT re-adopted
    expect(engine_view(store.getState()).fighters.get('mob-0').health).toBe(12)
  })

  test('a mid-wave equal-version divergence is DISCARDED, not logged (V3: absolute gate, mask intact)', () => {
    const store = boot()
    store.getState().input(
      {
        type: 'receipt',
        receipt: {
          events: [
            ...my_cast(),
            ev('TurnEnded', { is_mob: false, idx: 0 }),
            ev('TurnStarted', { is_mob: true, idx: 0 }),
            ev('MobMoved', { idx: 0, to_cell: 25 }),
            ev('TurnEnded', { is_mob: true, idx: 0 }),
            ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: T0 + 90_000 }),
          ],
        },
        version: 6,
      },
      T0 + 100
    )
    expect(store.getState().wave.some((t) => !t.is_local)).toBe(true) // a masking mob wave drains
    store.getState().input({ type: 'snapshot', fight: fight_object({ mob_hp: 8 }), version: 6 }, T0 + 200)
    expect(store.getState().divergence).toBeNull() // no compare-adopt: an equal-version read is discarded outright
    expect(store.getState().view_version).toBe(5) // NOT adopted — the mask is intact
  })
})

describe('INC-1 duplicate receipt = one wave (register #8)', () => {
  const mob_turn = {
    events: [
      ev('TurnEnded', { is_mob: false, idx: 0 }),
      ev('TurnStarted', { is_mob: true, idx: 0 }),
      ev('MobMoved', { idx: 0, to_cell: 25 }),
      ev('TurnEnded', { is_mob: true, idx: 0 }),
      ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: T0 + 90_000 }),
    ],
  }

  test('a re-delivered receipt at the same version does not append a second visual wave', () => {
    const store = boot()
    store.getState().input({ type: 'receipt', receipt: mob_turn, version: 6 }, T0 + 100)
    expect(store.getState().wave.filter((t) => !t.is_local).length).toBe(1)
    store.getState().input({ type: 'receipt', receipt: mob_turn, version: 6 }, T0 + 150) // reconnect catch-up
    expect(store.getState().wave.filter((t) => !t.is_local).length).toBe(1) // still ONE wave, not two
  })
})
