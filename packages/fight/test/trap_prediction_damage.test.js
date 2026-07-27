// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// ①② TRAP PREDICTION DAMAGE — a live symptom where pushing a mob onto a trap floated the push number but not
// the trap damage; trap damage only reconciled after, sometimes ending the fight retroactively.
//
// ROOT (now fixed): the predicted `my_traps` the sim door builds carried payload:[] because the durable my_traps
// record stored CELLS ONLY — the trap-cast's real payload was dropped at predict_cast.placed_traps. So check_traps
// FORCE-STOPPED the push on the right cell (my_traps_fold proves the landing) but apply_payload([]) dealt ZERO
// damage → no predicted floater, no predicted kill, no predicted fight-end; trap damage arrived only via receipt
// reconcile (the exact symptom above). THE THREAD: predict_cast.placed_traps emits {cell, payload} → store.js
// my_traps record carries `payload` → project.js my_trap_payloads → state_from_view rebuilds the trap WITH damage.
//
// `place_trap` below dispatches the {cell, payload} entry predict_cast.placed_traps now emits (DungeonBoard forwards
// it verbatim into place_traps) — the faithful stand-in for a real trap-cast fold.

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
const TRAP = enc(9, 5) // behind the mob, in the push direction — the push lands the mob here

// The detonation payload the trap carries — a flat FIRE damage line, exactly the shape apply_payload consumes.
const TRAP_PAYLOAD = [{ type: 'DAMAGE', element: 'FIRE', min: 40, max: 40 }]

const resolve_ref = (id) =>
  id === CHAR
    ? { is_mob: false, idx: 0 }
    : /^mob-(\d+)$/.test(String(id))
      ? { is_mob: true, idx: Number(String(id).slice(4)) }
      : null

const fight_object = (mob_hp = 200) => ({
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
  mobs: [{ template: '0xabc', hp: mob_hp, max_hp: 200, cell: MOB, ap: 4, mp: 3, level: 1 }],
  queue: [{ is_mob: false, idx: 0 }],
  turn_ptr: 0,
  turn_deadline_ms: 90_000,
  turn_entropy: 90_000,
  turn_ordinal: 1,
})

const boot = (mob_hp = 200) => {
  const store = create_fight_store()
  store
    .getState()
    .input({ type: 'init', fight_id: FIGHT, my_key: 'p0', ctx: { my_entity_id: CHAR, beat_ctx: { grid_width: W } } })
  store.getState().input({ type: 'snapshot', fight: fight_object(mob_hp), version: 5 }, 1_000)
  return store
}

// place MY trap on TRAP carrying its payload, exactly as the trap-cast fold does (predict_cast.placed_traps shape).
const place_trap = (store) =>
  store.getState().input(
    {
      type: 'predicted',
      basis_version: 6,
      intent_id: 'trap1',
      actions: [{ kind: 'Cast', caster_is_mob: false, caster_idx: 0, target_cell: TRAP, ap_cost: 2 }],
      beats: [{ kind: 'cast', at: 0, duration: 100, payload: {} }],
      place_traps: [{ cell: TRAP, payload: TRAP_PAYLOAD }],
    },
    1_100
  )

const push_spell = single_effect_spell('push', { kind: SE.K_PUSH, value: 5, target_filter: SE.TF_NOT_TEAM }, 3, false)
const predict_push = (store) =>
  predict_cast({
    view: engine_view(store.getState()),
    caster_id: CHAR,
    spell: push_spell,
    target_cell: MOB,
    resolve_ref,
  })

describe('①② push onto my trap must PREDICT the trap damage (twin with the chain)', () => {
  test('the push force-stops the mob ON my trap (proven today — the landing is right)', () => {
    const store = boot()
    place_trap(store)
    const pred = predict_push(store)
    expect(pred.actions.find((a) => a.kind === 'Displaced')?.to_cell).toBe(TRAP)
  })

  test('the trap detonates in PREDICTION: a Hit on the mob + a trap_trigger beat with damage > 0', () => {
    const store = boot()
    place_trap(store)
    const pred = predict_push(store)
    // force-stop lands the mob on the trap (works today)…
    expect(pred.actions.find((a) => a.kind === 'Displaced')?.to_cell).toBe(TRAP)
    // …and the trap detonates: a damage Hit on the pushed mob (the floater) + a trap_trigger beat carrying it.
    const trap_hits = pred.actions.filter((a) => a.kind === 'Hit' && a.victim_is_mob && a.victim_idx === 0)
    expect(trap_hits.length, 'a push onto my trap must PREDICT the trap damage Hit').toBeGreaterThan(0)
    const trap_beats = pred.beats.filter((b) => b.kind === 'trap_trigger' && (b.payload?.damage ?? 0) > 0)
    expect(trap_beats.length, 'the trap detonation gets its OWN damage beat/floater').toBeGreaterThan(0)
  })

  test('a trap-kill ENDS the fight in prediction (twin of the already-green direct-kill end)', () => {
    const store = boot(30) // 30 HP mob dies to the 40-damage trap → team1 wiped → fight ends
    place_trap(store)
    const pred = predict_push(store)
    expect(pred.actions.find((a) => a.kind === 'Displaced')?.to_cell).toBe(TRAP)
    // the trap kills the last enemy → the sim emits fight_ended → a fight_end beat is PREDICTED (not reconcile-only).
    expect(
      pred.beats.some((b) => b.kind === 'fight_end'),
      'a predicted trap-kill must end the fight'
    ).toBe(true)
  })

  test('predict_cast.placed_traps emits the {cell, payload} entry the store folds (the threading contract)', () => {
    const store = boot()
    const trap_spell = single_effect_spell(
      'trap',
      { kind: SE.K_PLACE_TRAP, value: 0, target_filter: SE.TF_NONE },
      2,
      true
    )
    const pred = predict_cast({
      view: engine_view(store.getState()),
      caster_id: CHAR,
      spell: trap_spell,
      target_cell: TRAP,
      resolve_ref,
    })
    // predict_cast emits {cell, payload} per placed trap-cell — the exact shape DungeonBoard forwards to place_traps.
    expect(pred.placed_traps.length).toBeGreaterThan(0)
    for (const entry of pred.placed_traps) {
      expect(entry).toHaveProperty('cell')
      expect(entry).toHaveProperty('payload')
      expect(Array.isArray(entry.payload)).toBe(true)
    }
  })
})

// ④ RIDER — SUPERSEDED: a trap stays armed+rendered until the chain says fired. The 07-19 fix retired a trap on ANY newer
// authoritative base (`superseded`: view_version advanced past placement) to catch an UNOBSERVED transit. That
// sledgehammer retired EVERY untriggered trap on the next ROUTINE POLL: the sim door dropped its force-stop/damage
// while the chain kept it armed, and a re-cast then aborted ECellAlreadyTrapped and nuked the whole turn batch —
// observed live. It is REMOVED. The truncation-stops invariant (movement.move:32-39 · reduce.js:415-423 — a
// fighter STOPS on the first trap it enters) makes it redundant for every OBSERVED path: a real firing leaves the
// trigger STANDING (or dead — leg-E) on the cell, which `detonated` catches from the receipt tail OR a wholesale
// snapshot's committed base. The residual — a multi-turn UNOBSERVED enter-then-leave — is left ARMED (a benign
// phantom the legality gate refuses locally), NEVER retired without proof — the explicit rule is "err toward it
// stays", because a false RETIRE burns a turn while a false KEEP only refuses one re-cast.
const OFF = enc(3, 3) // a cell the mob is snapshotted to — never observed ON the trap (an unobserved advance)
const snapshot_with_mob_at = (store, cell, version, at) =>
  store.getState().input(
    {
      type: 'snapshot',
      fight: {
        ...fight_object(200),
        mobs: [{ template: '0xabc', hp: 200, max_hp: 200, cell, ap: 4, mp: 3, level: 1 }],
      },
      version,
    },
    at
  )
const mob_moved = (to_cell) => ({ type: '0x0::fight_events::MobMoved', parsedJson: { fight: FIGHT, idx: 0, to_cell } })

describe('④ an untriggered trap survives an unobserved snapshot advance (v1.12.34: stays until the chain says fired)', () => {
  test('a routine poll that never showed a fighter ON the trap keeps it ARMED, not gone', () => {
    const store = boot()
    place_trap(store)
    expect(engine_view(store.getState()).my_traps).toEqual([TRAP])
    // a newer wholesale read adopts with the mob elsewhere (OFF) — the client NEVER observed a fighter on the trap
    // cell, so there is NO chain consumption proof. A version bump is not a firing: the trap stays armed on-chain.
    snapshot_with_mob_at(store, OFF, 8, 1_200)
    expect(engine_view(store.getState()).my_traps).toEqual([TRAP]) // armed — "it stays" (was [] under superseded)
  })

  test('a receipt-proven ENTER still retires it (detonated is the ONE retirement proof)', () => {
    const store = boot()
    place_trap(store)
    snapshot_with_mob_at(store, OFF, 8, 1_200) // an unrelated poll first — the trap must still be retirable after it
    // the chain lands the mob ON the trap (on_enter) via a receipt → gone forever.
    store.getState().input({ type: 'receipt', version: 9, receipt: { events: [mob_moved(TRAP)] } }, 1_300)
    for (const t of store.getState().wave) store.getState().input({ type: 'presented', seq: t.seq }, 1_400)
    expect(engine_view(store.getState()).my_traps).toEqual([])
  })
})
