// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WAVE A — red-first violation repros (register V1/V2/V3/V9). Each reproduces the register's exact input
// sequence on the reducer; RED on the pre-fix code, GREEN after the algebra-on-substrate fix. These are the
// per-violation gates; the algebra PROPERTIES (BLANKPAGE §⑤ 1/2/6 + SEAT §4 T-B) live in reconcile_properties.test.js.

import { describe, expect, test } from 'bun:test'

import { state_hash } from './inputs.js'
import { merge_entries, foreign_replay_events } from './fold.js'
import { create_fight_store } from './store.js'
import { engine_view } from './project.js'
import { encode } from './los.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const MOB = encode(5, 4)
const MOB2 = encode(6, 4)
const TRAP = encode(9, 5)
const ev = (kind, json) => ({ type: `0x0::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...json } })

const FIGHT_OBJECT = {
  id: FIGHT,
  status: 1,
  width: 20,
  height: 19,
  participants: [
    { owner: '0xaaa', character: CHAR, class: 'senshi', team: 0, ap: 6, mp: 3, base_ap: 6, base_mp: 3, hp: 50, max_hp: 50, cell: encode(2, 2) },
  ],
  mobs: [{ template: '0xabc', hp: 8, max_hp: 30, cell: MOB, ap: 4, mp: 3, level: 1 }],
  queue: [
    { is_mob: false, idx: 0 },
    { is_mob: true, idx: 0 },
  ],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
}

const boot = () => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: 20 } } })
  store.getState().input({ type: 'snapshot', fight: FIGHT_OBJECT, version: 5 }, 1_000)
  return store
}
const drain = (store, now) => {
  for (const t of [...store.getState().wave]) store.getState().input({ type: 'presented', seq: t.seq }, now)
}
const mob0 = (store) => engine_view(store.getState()).fighters.get('mob-0')
const me = (store) => engine_view(store.getState()).fighters.get(CHAR)

describe('WAVE A red-first — V1/V2/V3/V9', () => {
  // V1 — RETIREMENT FLOOR. A death proven at vD must never resurrect from a later snapshot carrying positive hp.
  test('V1: a higher-version snapshot with positive hp does NOT resurrect a floor-dead mob', () => {
    const store = boot()
    store.getState().input({ type: 'receipt', fight_id: FIGHT, version: 6, receipt: { events: [ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 8, remaining_hp: 0 })] } }, 2_000)
    drain(store, 2_100)
    expect(mob0(store).committed_dead, 'the mob is floor-dead at v6').toBe(true)
    // a genuinely-newer wholesale read arrives with the mob ALIVE again (a torn/reordered read carrying positive hp)
    store.getState().input({ type: 'snapshot', fight: { ...FIGHT_OBJECT, mobs: [{ ...FIGHT_OBJECT.mobs[0], hp: 8 }] }, version: 7 }, 2_200)
    expect(mob0(store).committed_dead, 'a floor-dead fighter must never resurrect from a later positive-hp read').toBe(true)
  })

  // V2 — A5 OMISSION SEMANTICS. A snapshot that does not MODEL the status class must HOLD a receipt-floored invisibility.
  test('V2: a snapshot that OMITS the status class holds a receipt-floored invisibility', () => {
    const store = boot()
    store.getState().input({ type: 'receipt', fight_id: FIGHT, version: 6, receipt: { events: [ev('StanceChanged', { fighter_is_mob: false, fighter_idx: 0, stance: 27, active: true })] } }, 2_000)
    drain(store, 2_100)
    expect(me(store).invisible, 'invisibility floored by the receipt').toBe(true)
    // a genuinely-newer wholesale read that does NOT carry the status class (no invisibility_statuses field)
    store.getState().input({ type: 'snapshot', fight: { ...FIGHT_OBJECT }, version: 7 }, 2_200)
    expect(me(store).invisible, 'a thinner payload that omits the status class must not drop invisibility').toBe(true)
  })

  // V3 — MONOTONIC GATE ABSOLUTE. An equal-version divergent snapshot mid-fight is discarded, never re-adopted.
  test('V3: an equal-version divergent snapshot mid-fight is discarded (never re-adopted)', () => {
    const store = boot()
    // raise the applied floor above the adopted view via a receipt tail (view_version 5 < applied_version 6)
    store.getState().input({ type: 'receipt', fight_id: FIGHT, version: 6, receipt: { events: [ev('MobMoved', { idx: 0, to_cell: MOB2 })] } }, 2_000)
    drain(store, 2_100)
    const before = state_hash(store.getState())
    // an equal-version (v6) object read with DIFFERENT content (mob at a divergent cell) arrives mid-fight
    store.getState().input({ type: 'snapshot', fight: { ...FIGHT_OBJECT, mobs: [{ ...FIGHT_OBJECT.mobs[0], cell: encode(1, 1) }] }, version: 6 }, 2_200)
    expect(state_hash(store.getState()), 'an equal-version snapshot must not re-adopt — discard entirely (monotonic gate)').toBe(before)
  })

  // V9 — FLOOR PRIORITY. A snapshot-sourced entry must never override a receipt-proven entry at the same key.
  test('V9: a snapshot-sourced entry does NOT override a receipt-proven entry at the same key', () => {
    const receipt_entry = { version: 2, event_idx: 0, source: 'receipt', kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 10 }
    const snapshot_entry = { version: 2, event_idx: 0, source: 'snapshot', kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp: 99 }
    const merged = merge_entries({ '2:0': receipt_entry }, [snapshot_entry])
    expect(merged['2:0'].remaining_hp, 'receipt is the one-way floor; a snapshot must not override it').toBe(10)
  })

  // V10 — DEATH-BEAT DEDUP on the foreign_replay emit path. A death the eye already saw (my optimistic kill,
  // presented) must not be REPLAYED by a foreign snapshot that merely confirms it (symptom ② replayed die anim).
  test('V10: foreign_replay does NOT re-emit a death for an already-presented-dead target', () => {
    const escrow = [{ character: '0xc0' }, { character: '0xc1' }]
    const prev = { fighters: { m0: { key: 'm0', cell: 20, hp: 10, alive: true }, p1: { key: 'p1', cell: 5, hp: 50, alive: true } } }
    const next = { fighters: { m0: { key: 'm0', cell: 20, hp: 0, alive: false }, p1: { key: 'p1', cell: 6, hp: 50, alive: true } } }
    const hits = (opts) => foreign_replay_events(prev, next, { escrow, my_key: 'p0', ...opts }).filter((e) => String(e.type).endsWith('Hit')).length
    // the eye already saw m0 die (my optimistic kill) — the confirming foreign snapshot must NOT replay its death
    expect(hits({ presented_dead: new Set(['m0']) }), 'an already-presented death must not be re-emitted').toBe(0)
    // control: WITHOUT the cursor the death IS emitted — proving the dedup is what suppresses it (not a fluke)
    expect(hits({}), 'a genuinely-unseen foreign death is still emitted').toBe(1)
  })

  // B — drop_traps is a VERSION-GATED input (composite §1). A COMMITTED trap (basis_version at/below the applied
  // floor) is structurally immune to ANY stale reset, whoever fires it — the boundary rollback was the last
  // un-enumerated writer (same species as V3). This is the b5 interleaving: the commit receipt advances the floor
  // (trap committed) and flips presenting=true, then the turn-boundary drop_traps fires for the still-pending cell.
  const cast_trap = (store) =>
    store.getState().input({ type: 'predicted', basis_version: 6, intent_id: 'trap1', actions: [{ kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: TRAP, ap_cost: 2 }], beats: [{ kind: 'cast', at: 0, duration: 100, payload: {} }], place_traps: [TRAP] }, 1_100)

  test('B: a COMMITTED trap survives a stale boundary drop_traps at presenting=true (b5 interleaving)', () => {
    const store = boot()
    cast_trap(store) // uncommitted: basis 6 > applied 5
    expect(engine_view(store.getState()).my_traps).toEqual([TRAP])
    // END TURN → the single-PTB commit lands (my turn + mob wave): the floor advances past basis (committed) and
    // the mob wave flips presenting=true. Nobody touches the trap cell.
    store.getState().input({ type: 'receipt', fight_id: FIGHT, version: 7, receipt: { events: [
      ev('TurnEnded', { is_mob: false, idx: 0 }),
      ev('TurnStarted', { is_mob: true, idx: 0 }),
      ev('Cast', { caster_is_mob: true, caster_idx: 0, target_cell: encode(2, 2) }),
      ev('Hit', { victim_is_mob: false, victim_idx: 0, amount: 6, remaining_hp: 44 }),
      ev('TurnEnded', { is_mob: true, idx: 0 }),
      ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 120_000 }),
    ] } }, 2_000)
    expect(engine_view(store.getState()).presenting, 'the mob wave is presenting').toBe(true)
    // the turn-boundary rollback fires drop_traps for the still-pending (now COMMITTED) cell — the b5 race edge.
    store.getState().input({ type: 'drop_traps', cells: [TRAP] }, 2_050)
    expect(engine_view(store.getState()).my_traps, 'a committed trap is immune to any stale reset (persists through presenting=true)').toEqual([TRAP])
  })

  test('B: an UNCOMMITTED trap still rolls back on drop_traps (the version-gate does not over-protect)', () => {
    const store = boot()
    cast_trap(store) // basis 6 > applied 5 — never committed
    expect(engine_view(store.getState()).my_traps).toEqual([TRAP])
    store.getState().input({ type: 'drop_traps', cells: [TRAP] }, 1_200) // the turn passed without committing it
    expect(engine_view(store.getState()).my_traps, 'a never-committed trap must still roll back').toEqual([])
  })
})
