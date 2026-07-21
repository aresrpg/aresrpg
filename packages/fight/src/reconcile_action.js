// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Prediction reconciliation by CLAIM IDENTITY (issue #308 — M6). A predicted action carries a CLAIM: its kind +
// actor (`comparable(action).action`, e.g. `Hit:m0`, `Displaced:m2`, `Cast:p0`) and an OUTCOME (the delta the
// receipt would carry). The canonical event stream produces the SAME claim vocabulary, so a prediction retires
// by identity — matched to the receipt's own claim — never by a blanket version purge:
//   · a canonical action whose claim matches a pending prediction RETIRES it: byte/outcome-match ⇒ silent (it
//     was merely early); a differing outcome on the SAME claim ⇒ ONE forward correction (the divergence toast).
//   · a canonical action with NO pending claim (an UNRELATED receipt) touches nothing — the prediction lives on.
//   · a receipt that ENDED MY TURN closes the window: any prediction it never claimed has missed its receipt and
//     resolves as mispredicted — one silent forward correction to committed truth.
// Only actions whose receipt carries the same absolute/delta fact are comparable; silent chain mutations (for
// example Granted) carry no chain event, so they retire with their cast's batch (composite atomicity) or expire.

const fighter_ref = (is_mob, idx) => `${is_mob ? 'm' : 'p'}${Number(idx)}`

const entry_key = (action) => `${action.version}:${action.event_idx}`

/** A comparable action's CLAIM (kind + actor) and OUTCOME (the delta the receipt carries). `null` for actions
 *  with no receipt-carried fact to reconcile (they retire with their batch or expire). A `Cast` is comparable
 *  by identity with an EMPTY delta — it anchors its batch (byte-matches always ⇒ never its own toast), so a
 *  buff/utility cast that emits no reconcilable effect still retires the instant its authoritative Cast lands. */
const comparable = (action) => {
  switch (action?.kind) {
    case 'Cast':
      return { action: `Cast:${fighter_ref(action.caster_is_mob, action.caster_idx)}`, delta: {} }
    case 'Hit':
      return {
        action: `Hit:${fighter_ref(action.victim_is_mob, action.victim_idx)}`,
        delta: { remaining_hp: Number(action.remaining_hp) },
      }
    case 'Moved':
      return { action: `Moved:${String(action.character)}`, delta: { to_cell: Number(action.to_cell) } }
    case 'MobMoved':
      return { action: `MobMoved:m${Number(action.idx)}`, delta: { to_cell: Number(action.to_cell) } }
    case 'Displaced':
      return {
        action: `Displaced:${fighter_ref(action.target_is_mob, action.target_idx)}`,
        delta: { to_cell: Number(action.to_cell) },
      }
    case 'Tackled':
      return {
        action: `Tackled:${fighter_ref(action.runner_is_mob, action.runner_idx)}`,
        delta: { ap_lost: Number(action.ap_lost), mp_lost: Number(action.mp_lost) },
      }
    case 'Drain':
      return {
        action: `Drain:${fighter_ref(action.target_is_mob, action.target_idx)}:${Number(action.point_kind)}`,
        delta: { removed: Number(action.removed) },
      }
    case 'StanceChanged':
      return {
        action: `StanceChanged:${fighter_ref(
          action.fighter_is_mob ?? action.target_is_mob,
          action.fighter_idx ?? action.target_idx
        )}`,
        delta: { active: !!(action.active ?? action.invisible) },
      }
    case 'Placed':
      return { action: `Placed:${String(action.character)}`, delta: { cell: Number(action.cell) } }
    default:
      return null
  }
}

/**
 * Reconcile the pending predictions against an authoritative receipt's actions — the death of purge-on-divergence.
 * Matching is FIFO per claim key, so the ordinal (the Nth `Hit:m0` of a multi-strike cast) is preserved. Returns
 * the set of prediction entry keys to RETIRE and the first same-claim outcome MISMATCH (one forward correction).
 * @param {Array<object>} pending      intent entries eligible to be claimed (source 'intent', version ≤ receipt)
 * @param {Array<object>} authoritative the receipt's normalized actions (already merged as the committed floor)
 * @param {{ version:number, at:number, ended_my_turn?:boolean }} ctx
 * @returns {{ retire: Set<string>, divergence: object|null }}
 */
export function reconcile_predictions(pending, authoritative, { version, at, ended_my_turn = false } = {}) {
  // FIFO claim queues from the pending predictions, in log order — the position within a claim key IS its ordinal.
  const queues = new Map()
  for (const entry of pending ?? []) {
    const row = comparable(entry)
    if (!row) continue
    queues.set(row.action, [
      ...(queues.get(row.action) ?? []),
      { key: entry_key(entry), delta: row.delta, intent_id: entry.intent_id ?? null },
    ])
  }
  const retire = new Set()
  const settled_ids = new Set()
  let divergence = null
  for (const action of authoritative ?? []) {
    const row = comparable(action)
    const queue = row ? queues.get(row.action) : null
    if (!queue?.length) continue // an UNRELATED canonical action — no pending claim to settle, touch nothing
    const [claim, ...rest] = queue // FIFO: the head is the next ordinal for this claim key (no mutation, L-I1)
    queues.set(row.action, rest)
    retire.add(claim.key)
    if (claim.intent_id != null) settled_ids.add(claim.intent_id)
    if (!divergence && JSON.stringify(claim.delta) !== JSON.stringify(row.delta))
      divergence = {
        kind: 'action',
        action: row.action,
        predicted: claim.delta,
        applied: row.delta,
        version: Number(version),
        at,
        shown: false,
      }
  }
  // COMPOSITE ATOMICITY + EXPIRY. A settled cast retires its WHOLE batch — the silent-mutation stragglers it
  // carries (Granted, an optimistic StanceChanged the chain emits no event for) leave WITH the cast, never
  // lingering to be observed apart from it. And a receipt that ENDED MY TURN closes the window: every prediction
  // it never claimed has missed its receipt — a mispredicted overlay, expired to committed truth (one forward
  // correction). The caller pre-filters `pending` to version ≤ the receipt, so expiry never reaches a prediction
  // that predicts a version beyond this receipt.
  for (const entry of pending ?? []) {
    const intent_id = entry.intent_id ?? null
    if ((intent_id != null && settled_ids.has(intent_id)) || ended_my_turn) retire.add(entry_key(entry))
  }
  return { retire, divergence }
}
