// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Prediction reconciliation by CLAIM IDENTITY (issue #308 — M6). A predicted action carries a CLAIM: its kind +
// actor (`comparable(action).action`, e.g. `Hit:m0`, `Displaced:m2`, `Cast:p0`) and an OUTCOME (the delta the
// receipt would carry). The canonical event stream produces the SAME claim vocabulary, so a prediction retires
// by identity — matched to the receipt's own claim — never by a blanket version purge:
//   · a canonical action whose claim matches a pending prediction RETIRES it: byte/outcome-match ⇒ silent (it
//     was merely early); a differing outcome on the SAME claim ⇒ ONE forward correction (the divergence toast).
//     A refused/absent expected prediction uses that same correction shape with `predicted:null` and
//     `refusal:<reason|'absent'>`; the subscriber keeps the one existing divergence log family.
//   · a canonical action with NO pending claim (an UNRELATED receipt) touches nothing — the prediction lives on.
//   · a receipt that ENDED MY TURN closes the window: any prediction it never claimed has missed its receipt and
//     resolves as mispredicted — one silent forward correction to committed truth.
// Only actions whose receipt carries the same absolute/delta fact are comparable; silent chain mutations (for
// example Granted) carry no chain event, so they retire with their cast's batch (composite atomicity) or expire.

const fighter_ref = (is_mob, idx) => `${is_mob ? 'm' : 'p'}${Number(idx)}`

const entry_key = (action) => `${action.version}:${action.event_idx}`

/** A comparable action's CLAIM (kind + actor; Cast also pins its per-cast target anchor) and OUTCOME (the delta the receipt carries). `null` for actions
 *  with no receipt-carried fact to reconcile (they retire with their batch or expire). A `Cast` is comparable
 *  by identity with an EMPTY delta — it anchors its batch (byte-matches always ⇒ never its own toast), so a
 *  buff/utility cast that emits no reconcilable effect still retires the instant its exact authoritative Cast lands. */
const comparable = (action) => {
  switch (action?.kind) {
    case 'Cast': {
      const target = action.target_cell == null ? '' : `:${Number(action.target_cell)}`
      return { action: `Cast:${fighter_ref(action.caster_is_mob, action.caster_idx)}${target}`, delta: {} }
    }
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
 * A claimed cast may also prove chain-silent point grants from its prediction batch. Those grants are returned as
 * bounded claim overlays instead of being promoted into the canonical log: a self-targeted Cast cannot traverse
 * RETURN_SPELL's living-enemy door, while CriticalFailure immediately before that Cast proves its payload did not
 * run. A matching payload sibling (for example StanceChanged) is independently a success proof for any target and
 * also covers journal pagination that splits it from the later Cast.
 * @param {Array<object>} pending      intent entries eligible to be claimed (source 'intent', version ≤ receipt)
 * @param {Array<object>} authoritative the receipt's normalized actions (already merged as the committed floor)
 * @param {{ version:number, at:number, ended_my_turn?:boolean, preceding?:object|null }} ctx
 * @returns {{ retire: Set<string>, divergence: object|null, claimed: Array<object> }}
 */
export function reconcile_predictions(
  pending,
  authoritative,
  { version, at, ended_my_turn = false, preceding = null } = {}
) {
  // FIFO claim queues from the pending predictions, in log order — the position within a claim key IS its ordinal.
  const queues = new Map()
  for (const entry of pending ?? []) {
    const row = comparable(entry)
    if (!row) continue
    queues.set(row.action, [
      ...(queues.get(row.action) ?? []),
      {
        key: entry_key(entry),
        delta: row.delta,
        intent_id: entry.intent_id ?? null,
        version: Number(entry.version),
        target_cell: entry.kind === 'Cast' ? entry.target_cell : null,
        refusal: entry.prediction_refusal ?? entry.refusal ?? null,
        entry,
      },
    ])
  }
  const retire = new Set()
  const settled_ids = new Set()
  const successful_ids = new Map()
  const failed_ids = new Set()
  const self_cast_ids = new Set(
    (pending ?? [])
      .filter((entry) => entry.kind === 'Cast' && entry.self_targeted && entry.intent_id != null)
      .map((entry) => entry.intent_id)
  )
  const claimed = []
  let divergence = null
  let previous = preceding
  for (const action of authoritative ?? []) {
    const row = comparable(action)
    const queue = row ? queues.get(row.action) : null
    if (!queue?.length || Number(action.version ?? version) < queue[0].version) {
      previous = action
      continue // an UNRELATED/older canonical action — no pending claim to settle, touch nothing
    }
    const [claim, ...rest] = queue // FIFO: the head is the next ordinal for this claim key (no mutation, L-I1)
    queues.set(row.action, rest)
    retire.add(claim.key)
    const refused = claim.refusal != null
    const outcome_match = !refused && JSON.stringify(claim.delta) === JSON.stringify(row.delta)
    if (claim.intent_id != null) {
      settled_ids.add(claim.intent_id)
      if (action.kind === 'Cast') {
        const same_actor =
          previous?.kind === 'CriticalFailure' &&
          !!previous.caster_is_mob === !!action.caster_is_mob &&
          Number(previous.caster_idx) === Number(action.caster_idx)
        const same_target =
          claim.target_cell != null &&
          action.target_cell != null &&
          Number(claim.target_cell) === Number(action.target_cell)
        if (same_actor) failed_ids.add(claim.intent_id)
        else if (same_target && !successful_ids.has(claim.intent_id))
          successful_ids.set(claim.intent_id, {
            proof: 'cast',
            version: Number(action.version ?? version),
            event_idx: Number(action.event_idx),
          })
      } else {
        // A receipt-carried sibling can only exist when the cast payload ran. This also covers a journal page that
        // ends before the Cast anchor: composite retirement remains atomic without losing its silent grant.
        successful_ids.set(claim.intent_id, {
          proof: 'sibling',
          version: Number(action.version ?? version),
          event_idx: Number(action.event_idx),
        })
      }
    }
    // Canonical Moved omits its budget mutation, just as Cast omits give_points. When its destination/outcome
    // matches, retain the prediction's signed mp_delta (with legacy mp_left fallback) as another bounded budget
    // claim so page-by-page retirement cannot resurrect spent MP between a Cast grant and TurnEnded.
    if (outcome_match && action.kind === 'Moved' && claim.entry?.mp_left != null)
      claimed.push({
        key: `move:${claim.key}`,
        intent_id: claim.intent_id,
        claimed_at: {
          version: Number(action.version ?? version),
          event_idx: Number(action.event_idx),
        },
        action: { ...claim.entry, source: 'claim' },
      })
    if (!divergence && !outcome_match)
      divergence = {
        kind: 'action',
        action: row.action,
        predicted: refused ? null : claim.delta,
        ...(refused ? { refusal: claim.refusal } : {}),
        applied: row.delta,
        // The adopted ROW itself — the only thing that can correct the history the prediction already wrote
        // (#2151). A `remaining_hp` delta says the prediction was wrong; it does not say what to print instead.
        // The presentation adapter prices this and drops it; nothing durable keeps a raw action row.
        applied_action: action,
        version: Number(action.version ?? version),
        at,
        shown: false,
      }
    previous = action
  }
  // COMPOSITE ATOMICITY + EXPIRY. A settled cast retires its WHOLE batch — the silent-mutation stragglers it
  // carries (Granted, an optimistic StanceChanged the chain emits no event for) leave WITH the cast, never
  // lingering to be observed apart from it. And a receipt that ENDED MY TURN closes the window: every prediction
  // it never claimed has missed its receipt — a mispredicted overlay, expired to committed truth (one forward
  // correction). The caller pre-filters `pending` to version ≤ the receipt, so expiry never reaches a prediction
  // that predicts a version beyond this receipt.
  const retired_intents = new Set()
  for (const entry of pending ?? []) {
    const intent_id = entry.intent_id ?? null
    const settled = intent_id != null && settled_ids.has(intent_id)
    const success = successful_ids.get(intent_id)
    // COURTESY (channel two, #334): a peer's relayed prediction retires ONLY by its own claim (byte-match ⇒ silent,
    // mismatch ⇒ one forward correction). MY end-of-turn blanket is MY boundary; applying it to a peer's overlay
    // would be the forbidden purge-on-unrelated-receipt, so the blanket expiry skips `courtesy` entries entirely.
    const expired = ended_my_turn && !entry.courtesy
    if (settled || expired) retire.add(entry_key(entry))
    if (intent_id != null && (settled || expired)) retired_intents.add(intent_id)
    if (
      settled &&
      entry.kind === 'Granted' &&
      success &&
      !failed_ids.has(intent_id) &&
      (success.proof === 'sibling' || self_cast_ids.has(intent_id))
    )
      claimed.push({
        key: `${intent_id}:${entry_key(entry)}`,
        intent_id,
        claimed_at: { version: success.version, event_idx: success.event_idx },
        action: { ...entry, source: 'claim' },
      })
  }
  return { retire, divergence, claimed, retired_intents }
}
