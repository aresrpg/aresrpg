// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Non-canonical budget proof helpers for M2b claim retirement. These never admit canonical history: accept_batch
// remains the one ingress; they only retain simulator facts whose accepted events omit pool values.

import { apply_action, fighter_key } from './inputs.js'

export const prediction_identity = (action) =>
  `${action.intent_id ?? ''}:${action.kind}:${action.version}:${action.event_idx}`

/** Restore budget prediction evidence displaced by a p2p/poll canonical key collision. A Cast returns as an inert
 * CastAnchor marker: draft ordering can still see it, while cast-count/AP consumers never count the canonical Cast
 * and its prediction twice. Granted and Moved retain their own composable budget deltas. Accepted history is
 * untouched: every restored row remains source `intent`. */
export const with_budget_predictions = (log, budget_predictions) => {
  if (!(budget_predictions ?? []).length) return log
  const out = [...(log ?? [])]
  // Canonical rows never satisfy prediction evidence, even when they occupy its exact (version,event_idx).
  const seen = new Set(out.filter((action) => action.source === 'intent').map(prediction_identity))
  for (const { action } of budget_predictions) {
    const key = prediction_identity(action)
    if (!seen.has(key)) {
      out.push(action.kind === 'Cast' ? { ...action, kind: 'CastAnchor' } : action)
      seen.add(key)
    }
  }
  return out.sort((a, b) => a.version - b.version || a.event_idx - b.event_idx)
}

const budget_target = (action) => {
  if (action?.kind === 'Granted')
    return fighter_key({
      is_mob: action.target_is_mob,
      idx: action.target_idx,
      resolve_seat: action.resolve_seat,
    })
  if (action?.kind === 'Moved') return fighter_key({ character: action.character, resolve_seat: action.resolve_seat })
  if (action?.kind === 'Cast' || action?.kind === 'CastAnchor')
    return fighter_key({
      is_mob: action.caster_is_mob,
      idx: action.caster_idx,
      resolve_seat: action.resolve_seat,
    })
  return null
}

const boundary_target = (action) => {
  if (action?.kind === 'TurnEnded')
    return fighter_key({ is_mob: action.is_mob, idx: action.idx, resolve_seat: action.resolve_seat })
  if (action?.kind === 'Hit' && Number(action.remaining_hp) <= 0)
    return fighter_key({
      is_mob: action.victim_is_mob,
      idx: action.victim_idx,
      resolve_seat: action.resolve_seat,
    })
  if (action?.kind === 'Abandoned') return fighter_key({ is_mob: false, idx: action.seat })
  return null
}

/** A p2p/poll early copy deliberately does not retire predictions before journal proof, but its accepted target
 * TurnEnded/death is already a hard budget boundary. Keep the metadata for later claim reconciliation while making
 * only current-turn Cast ordering/AP, Granted, and Moved budget evidence inert in the effective log. */
export const without_expired_budget_predictions = (log) => {
  const boundaries = new Map()
  for (const action of log ?? []) {
    if (action.source === 'intent') continue
    const target = boundary_target(action)
    const version = Number(action.version)
    if (target && Number.isFinite(version))
      boundaries.set(target, Math.max(boundaries.get(target) ?? -Infinity, version))
  }
  if (!boundaries.size) return log
  const expired = (action) => {
    const target = budget_target(action)
    const boundary = target == null ? null : boundaries.get(target)
    return boundary != null && boundary >= Number(action.version)
  }
  return (log ?? []).filter((action) => {
    if (action.source !== 'intent') return true
    if (['Cast', 'CastAnchor', 'Granted', 'Moved'].includes(action.kind)) return !expired(action)
    return true
  })
}

export const claim_version = (row) => Number(row.claimed_at?.version ?? row.action?.version)

/** Fold accepted silent budget facts at their canonical claim anchors. They are deliberately NOT log entries:
 * canonical actions plus claim markers establish the authoritative floor first; surviving intents then layer above
 * that floor in their original order. TurnEnded removes rows in store.js. */
export const fold_claimed_budget = (base, log, claimed_budget) => {
  const rows = (claimed_budget ?? [])
    .filter((row) => row?.action?.kind === 'Granted' || row?.action?.kind === 'Moved')
    .map((row) => ({
      action: row.action,
      claim: true,
      key: row.key,
      version: claim_version(row),
      event_idx: Number(row.claimed_at?.event_idx ?? row.action.event_idx),
    }))
  if (!rows.length) return (log ?? []).reduce(apply_action, base)
  const intents = (log ?? []).filter((action) => action.source === 'intent')
  const canonical = (log ?? [])
    .filter((action) => action.source !== 'intent')
    .map((action) => ({
      action,
      claim: false,
      key: '',
      version: Number(action.version),
      event_idx: Number(action.event_idx),
    }))
  const ordered = [...canonical, ...rows].sort(
    (a, b) =>
      a.version - b.version ||
      a.event_idx - b.event_idx ||
      Number(a.claim) - Number(b.claim) ||
      a.key.localeCompare(b.key)
  )
  const active_grants = []
  let state = base
  for (const row of ordered) {
    if (row.claim) {
      if (row.action.kind === 'Granted') active_grants.push(row.action)
      state = apply_action(state, row.action)
      continue
    }
    state = apply_action(state, row.action)
    if (row.action.kind !== 'TurnStarted') continue
    const started = fighter_key({ is_mob: row.action.is_mob, idx: row.action.idx })
    for (const grant of active_grants)
      if (budget_target(grant) === started)
        // A later refill starts a fresh pool and the still-live credit row adds its ordinary delta again.
        state = apply_action(state, grant)
  }
  return intents.reduce(apply_action, state)
}
