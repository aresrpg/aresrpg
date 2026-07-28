// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ④+⑦b MY_TRAPS — the ONE fold-state home (ruled 07-19): the store's durable `my_traps`, populated by the
// trap-cast fold, sprung by the receipt-derived trigger beat, projected LIVE by engine_view, read by the sim
// door. trap_overlay is render-only — ZERO sim reads from it. This drives the whole lifecycle end to end.

import { describe, expect, test } from 'bun:test'

import { single_effect_spell } from '../../sim/test/spell_effect_conformance_matrix.js'
import * as SE from '../../sim/src/spell_effect.js'
import { create_fight_store } from '../src/store.js'
import { engine_view } from '../src/project.js'
import { predict_cast } from '../src/predict_cast.js'

const FIGHT = '0xf1'
const CHAR = '0xc1'
const W = 20
const enc = (x, y) => y * W + x
const ME = enc(5, 5)
const MOB = enc(7, 5)
const TRAP = enc(9, 5) // behind the mob, in the push direction
const OFF = enc(3, 3) // somewhere the mob walks off to

const ev = (kind, fields) => ({ type: `0x0::fight_events::${kind}`, parsedJson: { fight: FIGHT, ...fields } })
const resolve_ref = (id) =>
  id === CHAR
    ? { is_mob: false, idx: 0 }
    : /^mob-(\d+)$/.test(String(id))
      ? { is_mob: true, idx: Number(String(id).slice(4)) }
      : null

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
  mobs: [{ template: '0xabc', hp: 200, max_hp: 200, cell: MOB, ap: 4, mp: 3, level: 1 }],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1,
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

const push_spell = single_effect_spell('push', { kind: SE.K_PUSH, value: 5, target_filter: SE.TF_NOT_TEAM }, 3, false)
const predicted_push_landing = (store) =>
  predict_cast({
    view: engine_view(store.getState()),
    caster_id: CHAR,
    spell: push_spell,
    target_cell: MOB,
    resolve_ref,
  }).actions.find((a) => a.kind === 'Displaced')?.to_cell

describe('④+⑦b my_traps — the fold-state home drives the sim-door force-stop', () => {
  test('a predicted trap-cast populates engine_view.my_traps; a later push force-stops on it', () => {
    const store = boot()
    place_trap(store)
    expect(engine_view(store.getState()).my_traps).toEqual([TRAP])
    // the sim door reads view.my_traps → the push force-stops on my trap (no overshoot), exactly as the chain will.
    expect(predicted_push_landing(store)).toBe(TRAP)
  })

  test('the spring is durable: its receipt-derived trigger marks it gone FOREVER (mob moves off, still gone)', () => {
    const store = boot()
    place_trap(store)
    // a RECEIPT lands the mob ON the trap (chain detonation) → gone.
    store
      .getState()
      .input({ type: 'receipt', version: 7, receipt: { events: [ev('MobMoved', { idx: 0, to_cell: TRAP })] } }, 1_200)
    store.getState().input({ type: 'trap_triggered', anchor: TRAP, cell: TRAP, trigger_id: 'wave:trap1' }, 1_250)
    // present the masking wave so the committed fold is what engine_view reads.
    for (const t of store.getState().wave) store.getState().input({ type: 'presented', seq: t.seq }, 1_300)
    expect(engine_view(store.getState()).my_traps).toEqual([]) // sprung
    // …and the mob walks OFF next turn: the trap stays GONE (never regress a receipt-proven fact).
    store
      .getState()
      .input({ type: 'receipt', version: 8, receipt: { events: [ev('MobMoved', { idx: 0, to_cell: OFF })] } }, 1_400)
    for (const t of store.getState().wave) store.getState().input({ type: 'presented', seq: t.seq }, 1_500)
    expect(engine_view(store.getState()).my_traps).toEqual([]) // still gone — durable
  })

  test('a presented (optimistic) fighter on the cell cannot consume it without a receipt event', () => {
    const store = boot()
    place_trap(store)
    // MY optimistic push lands the mob on the trap, but position is not a lifecycle event.
    store.getState().input(
      {
        type: 'predicted',
        basis_version: 6,
        intent_id: 'push1',
        actions: [
          { kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: MOB, ap_cost: 3 },
          { kind: 'Displaced', target_is_mob: true, target_idx: 0, to_cell: TRAP },
        ],
        beats: [
          { kind: 'cast', at: 0, duration: 100, payload: {} },
          { kind: 'displacement', at: 100, duration: 200, payload: {} },
        ],
      },
      1_150
    )
    expect(engine_view(store.getState()).my_traps).toEqual([TRAP])
    // Rolling the push back leaves the same fold-projected trap unchanged.
    store.getState().input({ type: 'rollback', intent_id: 'push1' }, 1_160)
    expect(engine_view(store.getState()).my_traps).toEqual([TRAP])
  })

  test('drop_traps takes an uncommitted trap back (flush-drop / turn-boundary rollback)', () => {
    const store = boot()
    place_trap(store)
    expect(engine_view(store.getState()).my_traps).toEqual([TRAP])
    store.getState().input({ type: 'drop_traps', draft_ids: ['trap1'] }, 1_200)
    expect(engine_view(store.getState()).my_traps).toEqual([])
  })

  test('clears on fight init', () => {
    const store = boot()
    place_trap(store)
    store
      .getState()
      .input({ type: 'init', fight_id: '0xf2', my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: W } } })
    expect(store.getState().my_traps).toEqual([])
  })

  // RESIDUAL DIVERGENCE — still an issue in trap reconciliation between sim and chain:
  // a placed trap fires ON-CHAIN only when a fighter ENTERS its cell (spell_board::on_enter). A routine poll —
  // the fullnode re-reads the Fight OBJECT and its version bumps — is NOT a firing. The chain still holds the
  // trap armed. The client must too (Fight.fx is dropped from reads, so my_traps is a write-only optimistic
  // ledger that only a receipt-proven ENTER may retire). The old `superseded` predicate marked EVERY placed
  // trap gone on the next version advance → the sim door stopped predicting its force-stop/damage while the
  // chain kept it armed (and, dual-home, a re-cast then aborted ECellAlreadyTrapped and nuked the whole batch).
  test('a routine snapshot version bump (a poll) does NOT consume an untriggered trap — it stays armed', () => {
    const store = boot()
    place_trap(store) // placed against view_version 5
    expect(engine_view(store.getState()).my_traps).toEqual([TRAP])
    // a NEWER wholesale Fight read adopts (view_version 5 → 6) with NO fighter on the trap cell (mob still at MOB).
    store.getState().input({ type: 'snapshot', fight: { ...FIGHT_OBJECT }, version: 6 }, 1_200)
    expect(engine_view(store.getState()).my_traps).toEqual([TRAP]) // still armed — a version bump is not a firing
  })

  test('the sim door keeps predicting the force-stop across a version bump (sim↔chain parity)', () => {
    const store = boot()
    place_trap(store)
    store.getState().input({ type: 'snapshot', fight: { ...FIGHT_OBJECT }, version: 6 }, 1_200)
    // the chain still force-stops a push on the armed trap; the sim door (reads engine_view.my_traps) must too.
    expect(predicted_push_landing(store)).toBe(TRAP)
  })

  test('a real detonation trigger still retires the trap after a version bump (detonated, not superseded)', () => {
    const store = boot()
    place_trap(store)
    store.getState().input({ type: 'snapshot', fight: { ...FIGHT_OBJECT }, version: 6 }, 1_200)
    // a RECEIPT lands the mob ON the trap (chain on_enter) → gone, exactly as before.
    store
      .getState()
      .input({ type: 'receipt', version: 7, receipt: { events: [ev('MobMoved', { idx: 0, to_cell: TRAP })] } }, 1_300)
    store.getState().input({ type: 'trap_triggered', anchor: TRAP, cell: TRAP, trigger_id: 'wave:trap2' }, 1_350)
    for (const t of store.getState().wave) store.getState().input({ type: 'presented', seq: t.seq }, 1_400)
    expect(engine_view(store.getState()).my_traps).toEqual([]) // detonated by a proven ENTER
  })
})
