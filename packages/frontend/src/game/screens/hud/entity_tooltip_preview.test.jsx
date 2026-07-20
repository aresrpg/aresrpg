// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// NAMEPLATE PREDICTED OUTCOME: show exactly what will happen — damage taken, critical ?, effects,
// kill — e.g. life (6 −4) with the −4 in red, "kills the mob". The nameplate reads the EXACT outcome of the armed
// cast on the hovered target from the client cast-prediction path (predict_cast → @aresrpg/sim, the ONE damage
// home). predicted_target_outcome is the pure derivation over that prediction's canonical actions.
//
// DESIGN UPGRADE (07-20 crit line): the derivation now folds BOTH authored branches —
// predicted_target_outcome(base, crit, ref, hp): `base` is the guaranteed NON-crit outcome (the head number + the
// KILLS line); `crit` surfaces the crit branch as the "CRITICAL n% → −X / CRIT KILLS" line, and only when it
// genuinely differs from the base. The six pre-crit rows below are updated to the (base, crit) signature (each
// passes `null` for crit where only the base is under test) — a signature upgrade, never a behaviour regression.

import { describe, expect, test } from 'bun:test'

// imported from the dependency-free derivation module (EntityTooltip re-exports it too) so this unit never drags
// in the wiring hook's store/auth graph (which needs a browser window).
import { predicted_target_outcome } from './target_outcome.js'

const ref = { is_mob: true, idx: 0 }
// a fixture Hit as predict_cast emits it (changed_actions): the victim's ref + its exact post-cast hp.
const hit = (remaining_hp) => ({ kind: 'Hit', victim_is_mob: true, victim_idx: 0, remaining_hp })
const pred = (...actions) => ({ actions })

describe('predicted_target_outcome — the EXACT predicted effect on the hovered target', () => {
  test('a damaging cast yields the post-cast hp and a negative (red) delta; no crit supplied → crit null', () => {
    // hovered mob at 6 hp; the prediction drops it to 2 → the card shows "6 −4".
    const out = predicted_target_outcome(pred({ kind: 'cast' }, hit(2)), null, ref, 6)
    expect(out.remaining_hp).toBe(2)
    expect(out.delta).toBe(-4) // shown as "−4" in red — the spell's exact life reduction, never a range
    expect(out.kills).toBe(false)
    expect(out.crit).toBeNull()
  })

  test('DESIGN UPGRADE: the crit branch surfaces its own harder outcome when it differs from the base', () => {
    // base drops 6→2 (−4, the head); the crit branch drops it to 0 → the "CRITICAL … → −6 / CRIT KILLS" line.
    const out = predicted_target_outcome(pred(hit(2)), pred(hit(0)), ref, 6)
    expect(out.delta).toBe(-4) // the head stays the guaranteed NON-crit number
    expect(out.crit).toEqual({ delta: -6, kills: true }) // crit is harder AND lethal here
  })

  test('DESIGN UPGRADE: a crit that changes nothing (same outcome as base) yields NO crit line', () => {
    const out = predicted_target_outcome(pred(hit(2)), pred(hit(2)), ref, 6)
    expect(out.crit).toBeNull()
  })

  test('a lethal cast flags the kill (remaining ≤ 0) so the card can say KILLS THE MOB', () => {
    const out = predicted_target_outcome(pred(hit(0)), null, ref, 6)
    expect(out.kills).toBe(true)
    expect(out.remaining_hp).toBe(0)
  })

  test('a heal on the target (remaining > current) yields a positive (green) delta', () => {
    const out = predicted_target_outcome(pred(hit(10)), null, ref, 6)
    expect(out.delta).toBe(4)
    expect(out.kills).toBe(false)
  })

  test('a displacement surfaces the pushed-to cell for the push/pull line', () => {
    const displaced = { kind: 'Displaced', target_is_mob: true, target_idx: 0, to_cell: 42 }
    const out = predicted_target_outcome(pred(displaced), null, ref, 6)
    expect(out.displaced_to).toBe(42)
  })

  test('no action touching this target → no effect (null hp, zero delta, no kill)', () => {
    // an AoE that missed this mob, or an out-of-range aim: nothing to show, never a false "0".
    const out = predicted_target_outcome(
      pred({ kind: 'Hit', victim_is_mob: false, victim_idx: 3, remaining_hp: 1 }),
      null,
      ref,
      6
    )
    expect(out.remaining_hp).toBeNull()
    expect(out.delta).toBe(0)
    expect(out.kills).toBe(false)
    expect(out.displaced_to).toBeNull()
    expect(out.crit).toBeNull()
  })

  test('null prediction / null target ref → empty outcome (nothing armed or nothing hovered)', () => {
    expect(predicted_target_outcome(null, null, ref, 6).remaining_hp).toBeNull()
    expect(predicted_target_outcome(pred(hit(2)), null, null, 6).remaining_hp).toBeNull()
  })
})
