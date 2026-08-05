// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PURE projection of a cast prediction onto the hovered target's nameplate — show exactly what will
// happen: not the range, but the exact damage taken, effects, kill. Isolated in its own dependency-free module so
// the unit test exercises the derivation WITHOUT dragging in the wiring hook's store/auth graph (which needs a
// browser window). Reads ONLY the prediction's canonical actions (predict_cast → @aresrpg/sim, the ONE damage
// home) — never a second formula. The prediction is the SINGLE resolved outcome (crit or not — a fight is
// seed-deterministic, so the pending cast's branch is already decided upstream); this folds it into the head
// number + the KILLS line. Whether it was a crit rides the caller's `is_crit` flag (the head figure's styling),
// not a second line — the number itself is the crit tell.

const EMPTY_OUTCOME = Object.freeze({ remaining_hp: null, delta: 0, kills: false, displaced_to: null })

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
 * The hovered target's EXACT predicted outcome from the SINGLE resolved prediction (a predict_cast output — the
 * ONE sim run on the branch the fight's seed already decided upstream). Folds its Hit into the head number + the
 * KILLS line and surfaces the Displaced cell. Whether it was a crit is the caller's concern (the head figure's
 * bold-orange styling), never a second line — one number, deterministic.
 * @param {{ actions?: any[] } | null} prediction @param {{ is_mob: boolean, idx: number } | null} target_ref
 * @param {number} current_hp
 * @returns {{ remaining_hp: number|null, delta: number, kills: boolean, displaced_to: number|null }}
 */
export const predicted_target_outcome = (prediction, target_ref, current_hp) => {
  if (!target_ref) return EMPTY_OUTCOME
  return branch_outcome(prediction, target_ref, current_hp)
}

/**
 * #2175 — WHICH entities this prediction actually touches, as the caller's own candidate rows filtered down.
 * The INVERSE of `branch_outcome`'s per-target lookup, read off the SAME canonical action rows, so "has a
 * preview" and "renders something" are one fact by construction: a candidate survives exactly when
 * `predicted_target_outcome` would give it a number (a Hit) or a shove (a Displaced), and is dropped otherwise.
 *
 * This is the whole zone derivation. There is no zone geometry here and no damage math: `predict_cast` already
 * ran the WHOLE cast through the sim once — its AoE resolution, its per-entity resists, its kills — and diffed
 * every fighter into these actions. Asking the prediction who it touched is therefore the ONE home's own
 * answer; recomputing the covered cell set in the UI would be a second zone resolver disagreeing with the
 * chain the moment a shape, a resist or an obstacle changed.
 * @param {{ actions?: any[] } | null} prediction
 * @param {{ entity_id: string, target_ref: { is_mob: boolean, idx: number } | null }[]} candidates every live
 *   fighter, already carrying its resolved fold ref — the caller owns identity, this owns coverage.
 * @returns {{ entity_id: string, target_ref: { is_mob: boolean, idx: number } }[]}
 */
export const predicted_zone_targets = (prediction, candidates) =>
  (candidates ?? []).filter(({ target_ref }) => {
    if (!target_ref) return false
    // current_hp is irrelevant to coverage — only `delta` reads it, and it is discarded here.
    const { remaining_hp, displaced_to } = branch_outcome(prediction, target_ref, 0)
    return remaining_hp != null || displaced_to != null
  })
