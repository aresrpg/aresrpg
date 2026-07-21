// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// NAMEPLATE PREDICTED OUTCOME: show exactly what will happen — the exact damage taken, effects, kill — e.g.
// life (6 −4) with the −4 in red, "kills the mob". The nameplate reads the EXACT outcome of the armed cast on the
// hovered target from the client cast-prediction path (predict_cast → @aresrpg/sim, the ONE damage home).
// predicted_target_outcome is the pure derivation over that prediction's canonical actions.
//
// #163: the prediction is now the SINGLE resolved outcome (a fight is seed-deterministic, so the pending cast's
// crit branch is already decided upstream) — predicted_target_outcome(prediction, ref, hp) folds that one branch
// into the head number + KILLS line. Whether it was a crit is the caller's concern (the head figure's orange
// styling), never a second line, so there is no `crit` field here anymore.

import { describe, expect, test } from 'bun:test'

// imported from the dependency-free derivation module (EntityTooltip re-exports it too) so this unit never drags
// in the wiring hook's store/auth graph (which needs a browser window).
import { predicted_target_outcome } from './target_outcome.js'

const ref = { is_mob: true, idx: 0 }
// a fixture Hit as predict_cast emits it (changed_actions): the victim's ref + its exact post-cast hp.
const hit = (remaining_hp) => ({ kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp })
const pred = (...actions) => ({ actions })

describe('predicted_target_outcome — the EXACT predicted effect on the hovered target', () => {
  test('a damaging cast yields the post-cast hp and a negative (red) delta', () => {
    // hovered mob at 6 hp; the prediction drops it to 2 → the card shows "6 −4".
    const out = predicted_target_outcome(pred({ kind: 'cast' }, hit(2)), ref, 6)
    expect(out.remaining_hp).toBe(2)
    expect(out.delta).toBe(-4) // shown as "−4" in red — the spell's exact life reduction, never a range
    expect(out.kills).toBe(false)
  })

  test('a lethal cast flags the kill (remaining ≤ 0) so the card can say KILLS THE MOB', () => {
    const out = predicted_target_outcome(pred(hit(0)), ref, 6)
    expect(out.kills).toBe(true)
    expect(out.remaining_hp).toBe(0)
  })

  test('a heal on the target (remaining > current) yields a positive (green) delta', () => {
    const out = predicted_target_outcome(pred(hit(10)), ref, 6)
    expect(out.delta).toBe(4)
    expect(out.kills).toBe(false)
  })

  test('a displacement surfaces the pushed-to cell for the push/pull line', () => {
    const displaced = { kind: 'Displaced', target_is_mob: true, target_idx: 0, to_cell: 42 }
    const out = predicted_target_outcome(pred(displaced), ref, 6)
    expect(out.displaced_to).toBe(42)
  })

  test('no action touching this target → no effect (null hp, zero delta, no kill)', () => {
    // an AoE that missed this mob, or an out-of-range aim: nothing to show, never a false "0".
    const out = predicted_target_outcome(
      pred({ kind: 'Hit', victim_is_mob: false, victim_idx: 3, remaining_hp: 1 }),
      ref,
      6
    )
    expect(out.remaining_hp).toBeNull()
    expect(out.delta).toBe(0)
    expect(out.kills).toBe(false)
    expect(out.displaced_to).toBeNull()
  })

  test('null prediction / null target ref → empty outcome (nothing armed or nothing hovered)', () => {
    expect(predicted_target_outcome(null, ref, 6).remaining_hp).toBeNull()
    expect(predicted_target_outcome(pred(hit(2)), null, 6).remaining_hp).toBeNull()
  })
})
