// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// M6 — PREDICTIONS RETIRE BY CLAIM, THE PURGE VERB DIES (issue #308).
//
// The bug (diagnosed from captured traces, #340 lane replay): an optimistic predicted cast was
// PURGED by any intervening `receipt` at a version ≥ its basis — even an UNRELATED one (a peer/mob move that
// says nothing about the cast). presented state reverted to committed (the HP-rollback + "the fight changed
// on-chain" toast + the second death re-beat), then the cast CONFIRMED later. Provenance for these synthetic
// sequences (real 64-hex ids are gate-forbidden, so ids are synthetic and the shapes are reconstructed):
//   · aresrpg-fight-trace-0x9a06…-1784658245869.json (main seat) seq 463 → 485: predicted cast [Cast, Displaced]
//     at basis 948121015, then an unrelated receipt (peer Moved + MobMoved + TurnStarted) at v 948121282 > basis
//     purges it — the displacement only re-confirms turns later.
//   · the same fight's coop export + the two 0x355ff1f7… "nightmare" exports show the death re-beat variant.
// The cure: a prediction retires by IDENTITY (claim key = action kind + actor + ordinal), never by purge. A
// canonical event that matches its claim retires it (byte-match ⇒ silent, mismatch ⇒ one forward correction);
// an unrelated receipt NEVER touches it; a turn-ending receipt expires whatever it never claimed.

import { describe, expect, test } from 'bun:test'

import { active_store, ev, fight_object, mob, T0 } from '../harness/fixtures.js'
import { presented_state } from '../src/fold.js'
import { committed_truth } from '../src/store.js'

// A two-mob board so an "unrelated" action (touching m1) is unambiguously distinct from a cast on m0.
const two_mob_store = () => active_store({ fight: fight_object({ mobs: [mob(45, { hp: 20 }), mob(60, { hp: 20 })] }) })

const mob_hp = (store, key = 'm0') => presented_state(store.getState()).fighters?.[key]?.hp
const mob_alive = (store, key = 'm0') => presented_state(store.getState()).fighters?.[key]?.alive
const committed_hp = (store, key = 'm0') => committed_truth(store.getState()).fighters?.[key]?.hp

// MY optimistic cast: Cast by seat 0 + a Hit on the target mob down to `remaining_hp`. basis = the version the
// cast predicts (applied_version + 1) — the same shape predict_cast emits through the composite door.
const predict_cast_hit = (store, { intent_id, remaining_hp, victim_idx = 0 }) =>
  store.getState().input(
    {
      type: 'predicted',
      intent_id,
      basis_version: store.getState().applied_version + 1,
      actions: [
        { kind: 'Cast', caster_is_mob: false, caster_idx: 0, damaging: true },
        { kind: 'Hit', victim_is_mob: true, victim_idx, remaining_hp },
      ],
    },
    T0 + 1_000
  )

// An UNRELATED receipt: a bare MobMoved on the OTHER mob (m1), no cast/hit on m0, no TurnEnded for my seat — it
// says NOTHING about my pending cast. version is above the cast basis (the purge condition the bug tripped on).
const unrelated_receipt = (store, at = T0 + 2_000) =>
  store.getState().input(
    {
      type: 'receipt',
      version: store.getState().applied_version + 2,
      receipt: { events: [ev('MobMoved', { idx: 1, to_cell: 61 })] },
    },
    at
  )

// MY cast's OWN confirming receipt (Cast + the authoritative Hit). Lands at a fresh version above everything.
const confirm_cast_hit = (store, { remaining_hp, victim_idx = 0, at = T0 + 3_000 }) =>
  store.getState().input(
    {
      type: 'receipt',
      version: store.getState().applied_version + 1,
      receipt: {
        events: [
          ev('Cast', { caster_is_mob: false, caster_idx: 0 }),
          ev('Hit', { victim_is_mob: true, victim_idx, amount: 20 - remaining_hp, remaining_hp }),
        ],
      },
    },
    at
  )

describe('M6 — a predicted cast survives an unrelated receipt (the purge verb dies, #308)', () => {
  test('fixture 1 — unrelated receipt never touches the pending cast; it retires silently on its own receipt', () => {
    const store = two_mob_store()
    expect(committed_hp(store)).toBe(20)

    predict_cast_hit(store, { intent_id: 'cast:a', remaining_hp: 5 })
    expect(mob_hp(store), 'the optimistic cast paints m0 at 5').toBe(5)

    // The intervening UNRELATED receipt. HEAD purges the cast here (m0 reverts to 20); under claims it survives.
    unrelated_receipt(store)
    expect(mob_hp(store), 'an unrelated receipt must not revert the prediction').toBe(5)
    expect(store.getState().divergence, 'an unrelated receipt emits no correction toast').toBeNull()

    // The cast's OWN receipt confirms the exact predicted outcome — a silent retire, never a second toast.
    confirm_cast_hit(store, { remaining_hp: 5 })
    expect(mob_hp(store), 'confirmed value holds').toBe(5)
    expect(committed_hp(store), 'committed truth adopts the authoritative hit').toBe(5)
    expect(store.getState().divergence, 'a byte-match retires silently — ZERO prediction_reconciled').toBeNull()
  })

  test('fixture 1b — presented HP is MONOTONIC across the unrelated receipt (no rollback flicker)', () => {
    const store = two_mob_store()
    const seen = []
    const sample = () => seen.push(mob_hp(store))

    predict_cast_hit(store, { intent_id: 'cast:mono', remaining_hp: 8 })
    sample() // 8
    unrelated_receipt(store)
    sample() // HEAD: 20 (revert) — the bug; claims: 8
    confirm_cast_hit(store, { remaining_hp: 8 })
    sample() // 8

    // The eye must never see the mob heal back up: the sequence is non-increasing (20 → 8, never 8 → 20 → 8).
    for (let i = 1; i < seen.length; i++)
      expect(seen[i], `presented m0 hp rose (${seen[i - 1]} → ${seen[i]}) — a rollback flicker`).toBeLessThanOrEqual(
        seen[i - 1]
      )
  })

  test('fixture 2 — an optimistic KILL survives the unrelated receipt: the death presents exactly once', () => {
    const store = two_mob_store()
    predict_cast_hit(store, { intent_id: 'cast:kill', remaining_hp: 0 })
    expect(mob_alive(store), 'the optimistic kill paints m0 dead').toBe(false)

    // HEAD: the unrelated receipt purges the kill and m0 STANDS BACK UP (the resurrection that re-beats the death).
    unrelated_receipt(store)
    expect(mob_alive(store), 'the predicted corpse must not resurrect').toBe(false)

    confirm_cast_hit(store, { remaining_hp: 0 })
    expect(mob_alive(store), 'the confirmed kill stays dead — one death, never two').toBe(false)
    expect(store.getState().divergence, 'a confirmed kill retires silently').toBeNull()
  })

  test('fixture 3 — a canonical MISMATCH on the same claim key is ONE forward correction + one honest toast', () => {
    const store = two_mob_store()
    // Predict a kill; survive the unrelated receipt; the chain then says the mob lived at hp 4 (a real
    // misprediction). HEAD swallows the toast (the prediction was already purged, so there is nothing to
    // compare). Under claims the prediction is still pending → exactly one honest correction fires.
    predict_cast_hit(store, { intent_id: 'cast:miss', remaining_hp: 0 })
    unrelated_receipt(store)
    expect(mob_hp(store)).toBe(0)

    confirm_cast_hit(store, { remaining_hp: 4 })
    expect(mob_hp(store), 'presented moves ONCE, forward, to canonical truth').toBe(4)
    expect(committed_hp(store)).toBe(4)
    expect(store.getState().divergence, 'the honest mismatch surfaces exactly one toast').toMatchObject({
      kind: 'action',
      action: 'Hit:m0',
      predicted: { remaining_hp: 0 },
      applied: { remaining_hp: 4 },
      shown: false,
    })
  })

  test('fixture 4 — a REDELIVERED confirming receipt causes no double-retire and no second toast (#290)', () => {
    const store = two_mob_store()
    predict_cast_hit(store, { intent_id: 'cast:idem', remaining_hp: 4 })
    unrelated_receipt(store)

    confirm_cast_hit(store, { remaining_hp: 4, at: T0 + 3_000 })
    const after_first = presented_state(store.getState())
    const divergence_after_first = store.getState().divergence

    // The SAME authoritative fact, redelivered (receipt + 4s poll + p2p all carry one version) — must be inert.
    store.getState().input(
      {
        type: 'receipt',
        version: store.getState().applied_version, // same version — a re-delivery
        receipt: {
          events: [
            ev('Cast', { caster_is_mob: false, caster_idx: 0 }),
            ev('Hit', { victim_is_mob: true, victim_idx: 0, amount: 16, remaining_hp: 4 }),
          ],
        },
      },
      T0 + 4_000
    )
    expect(presented_state(store.getState()).fighters.m0.hp, 'redelivery leaves presented state unchanged').toBe(
      after_first.fighters.m0.hp
    )
    expect(store.getState().divergence, 'no second correction on redelivery').toEqual(divergence_after_first)
  })
})
