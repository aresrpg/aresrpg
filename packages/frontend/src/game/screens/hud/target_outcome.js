// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PURE projection of a cast prediction onto the hovered target's nameplate — show exactly what will
// happen: not the range, but damage taken, critical chance, effects, kill. Isolated in its own dependency-free module so
// the unit test exercises the derivation WITHOUT dragging in the wiring hook's store/auth graph (which needs a
// browser window). Reads ONLY the prediction's canonical actions (predict_cast → @aresrpg/sim, the ONE damage
// home) — never a second formula. Both authored branches are folded here: `base` is the guaranteed NON-crit
// outcome (the head number + the KILLS line), `crit` is the crit branch (the "CRITICAL N% → X" line) when it
// meaningfully differs — so a crit-capable spell always shows its guaranteed floor AND its crit ceiling.

const EMPTY_OUTCOME = Object.freeze({ remaining_hp: null, delta: 0, kills: false, displaced_to: null, crit: null })

export { EMPTY_OUTCOME }

/**
 * One prediction's exact effect on the target: the Hit's post-cast hp → a signed `delta` (negative = life
 * reduction, positive = a heal), a `kills` flag (sim dropped it to ≤ 0), and the encoded Displaced cell. Empty
 * (null hp, zero delta) when nothing touches this target (out-of-range aim / an AoE that missed it) — never a
 * false "0". @param {{ actions?: any[] } | null} prediction @param {{ is_mob: boolean, idx: number } | null} target_ref
 * @param {number} current_hp @returns {{ remaining_hp: number|null, delta: number, kills: boolean, displaced_to: number|null }}
 */
const branch_outcome = (prediction, target_ref, current_hp) => {
  if (!target_ref) return { remaining_hp: null, delta: 0, kills: false, displaced_to: null }
  const actions = prediction?.actions ?? []
  const mine = (action, is_key, idx_key) => action[is_key] === target_ref.is_mob && action[idx_key] === target_ref.idx
  const hit = actions.find((action) => action.kind === 'Hit' && mine(action, 'victim_is_mob', 'victim_idx'))
  const displaced = actions.find((action) => action.kind === 'Displaced' && mine(action, 'target_is_mob', 'target_idx'))
  const remaining_hp = hit ? hit.remaining_hp : null
  return {
    remaining_hp,
    delta: remaining_hp != null ? remaining_hp - current_hp : 0, // <0 = damage (red), >0 = heal (green)
    kills: remaining_hp != null && remaining_hp <= 0,
    displaced_to: displaced ? displaced.to_cell : null,
  }
}

/**
 * The hovered target's EXACT predicted outcome, from the non-crit `base` prediction and the optional `crit`
 * prediction (both predict_cast outputs — the SAME sim, one run per branch). The head + KILLS read the base
 * (the guaranteed outcome); `crit` is non-null only when a crit branch exists and its outcome genuinely differs
 * (a bigger hit, or a kill the base doesn't land) — the "CRITICAL … → X / CRIT KILLS" split, never a duplicate
 * line for a spell whose crit changes nothing. Displacement rides the base branch (crit never moves a target
 * differently). @param {{ actions?: any[] } | null} base @param {{ actions?: any[] } | null} crit
 * @param {{ is_mob: boolean, idx: number } | null} target_ref @param {number} current_hp
 * @returns {{ remaining_hp: number|null, delta: number, kills: boolean, displaced_to: number|null,
 *   crit: { delta: number, kills: boolean } | null }}
 */
export const predicted_target_outcome = (base, crit, target_ref, current_hp) => {
  if (!target_ref) return EMPTY_OUTCOME
  const b = branch_outcome(base, target_ref, current_hp)
  const c = crit ? branch_outcome(crit, target_ref, current_hp) : null
  return {
    remaining_hp: b.remaining_hp,
    delta: b.delta,
    kills: b.kills,
    displaced_to: b.displaced_to,
    // the crit line only when a crit outcome actually lands AND it differs from the base (harder hit or a
    // crit-only kill) — otherwise the crit changes nothing worth its own line.
    crit: c && c.remaining_hp != null && (c.delta !== b.delta || c.kills !== b.kills) ? { delta: c.delta, kills: c.kills } : null,
  }
}
