// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// core_diagnostics.js — a cross-client fingerprint of CANONICAL chain truth. This is a projection over the one
// fold, never another state home: local identity, intents, pacing, deadlines and arrival provenance are excluded.

import { hash_state } from '@aresrpg/sim/evolve'

import { fold_canonical } from './core_fold.js'
import { participant_entity_id } from './fight_control.js'
import { truth_frontier } from './core_inbox.js'

const finite_or_null = (value) => {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** A fold fighter key → its chain identity. Players use Character ids; mobs have chain-stable slot identities. */
const entity_id = (view, key) => {
  if (key.startsWith('p')) {
    const seat = Number(key.slice(1))
    return participant_entity_id(view?.escrow?.[seat]) ?? `player-${seat}`
  }
  if (key.startsWith('m')) return `mob-${Number(key.slice(1))}`
  if (key.startsWith('c:')) return key.slice(2)
  return key
}

const actor_id = (view, actor) => {
  if (!actor) return null
  return actor.is_mob ? `mob-${Number(actor.idx)}` : entity_id(view, `p${Number(actor.idx)}`)
}

/** Status rows are a multiset on chain. Normalize absent optionals and sort the values, preserving duplicates. */
const active_statuses = (fighter) =>
  (fighter?.statuses ?? [])
    .filter((status) => Number(status?.remaining_turns) > 0)
    .map((status) => ({
      kind: finite_or_null(status.kind),
      remaining_turns: finite_or_null(status.remaining_turns),
      element: finite_or_null(status.element),
      value: finite_or_null(status.value),
      stat: finite_or_null(status.stat),
      chance: finite_or_null(status.chance),
      source: finite_or_null(status.source),
      flags: finite_or_null(status.flags),
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

const canonical_roster = (inbox, board) =>
  Object.entries(board.fighters ?? {})
    .map(([key, fighter]) => ({
      id: entity_id(inbox.base_view, key),
      cell: finite_or_null(fighter.cell),
      hp: finite_or_null(fighter.hp),
      statuses: active_statuses(fighter),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

/** The last TurnStarted above the adopted base, independent of delivery/object insertion order. */
const latest_turn_started = (inbox) =>
  Object.values(inbox.log ?? {}).reduce((latest, action) => {
    if (action.kind !== 'TurnStarted' || Number(action.version) <= Number(inbox.base_version)) return latest
    if (!latest) return action
    const version = Number(action.version)
    const latest_version = Number(latest.version)
    const event_idx = Number(action.event_idx)
    const latest_idx = Number(latest.event_idx)
    return version > latest_version || (version === latest_version && event_idx > latest_idx) ? action : latest
  }, null)

const turn_anchor = (inbox) => {
  const event = latest_turn_started(inbox)
  if (event)
    return {
      source: 'event',
      version: Number(event.version),
      event_idx: Number(event.event_idx),
      owner: actor_id(inbox.base_view, { is_mob: !!event.is_mob, idx: event.idx }),
    }
  const turn_ptr = Number(inbox.base_view?.turn_ptr ?? -1)
  return {
    source: 'snapshot',
    base_version: Number(inbox.base_version),
    turn_ptr,
    owner: actor_id(inbox.base_view, inbox.base_view?.turn_queue?.[turn_ptr]),
  }
}

/**
 * Hash the canonical fold exactly once. The report leaves the frontier outside the hash: it explains ingestion
 * position, while the digest answers whether the two clients hold the same roster/status/turn truth.
 * @param {import('./core_state.js').InboxState} inbox
 */
export const canonical_fingerprint = (inbox) => {
  const board = fold_canonical(inbox)
  const anchor = turn_anchor(inbox)
  const roster = canonical_roster(inbox, board)
  return {
    hash: hash_state({ turn_anchor: anchor, roster }),
    turn_anchor: anchor,
    roster_count: roster.length,
    frontier: truth_frontier(inbox),
  }
}
