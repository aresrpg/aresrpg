// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// Viewer-free divergence fingerprint. This hashes only canonical fold facts, never local identity, prediction,
// pacing, or renderer state. Every viewer of one fight therefore publishes the same digest for the same frontier.

import { participant_entity_id } from './fight_control.js'
import { project_board } from './core_project.js'

const stable_value = (value) => {
  if (Array.isArray(value)) return value.map(stable_value)
  if (value == null || typeof value !== 'object') return value ?? null
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stable_value(value[key])])
  )
}

const status_image = (status) =>
  stable_value({
    kind: Number(status?.kind ?? 0),
    remaining_turns: Number(status?.remaining_turns ?? 0),
    element: status?.element ?? null,
    value: status?.value ?? null,
    stat: status?.stat ?? null,
    chance: status?.chance ?? null,
    source: status?.source ?? null,
    flags: status?.flags ?? null,
  })

const roster_id = (view, key) => {
  if (key.startsWith('p')) {
    const participant = view?.escrow?.[Number(key.slice(1))]
    return participant_entity_id(participant ?? {}) ?? participant?.character ?? key
  }
  return key.startsWith('m') ? `mob-${Number(key.slice(1))}` : key
}

/** Canonical byte image required by #1336: roster identities/cells/HP, owner + chain turn ordinal, statuses. */
export const fingerprint_state = (core) => {
  const board = project_board(core)
  const view = core?.inbox?.base_view
  const roster = Object.keys(board.fighters ?? {})
    .map((key) => {
      const fighter = board.fighters[key]
      return {
        id: String(roster_id(view, key)),
        cell: fighter?.cell ?? null,
        hp: fighter?.hp ?? null,
        statuses: (fighter?.statuses ?? [])
          .map(status_image)
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
  return {
    roster,
    active: board.active == null ? null : String(roster_id(view, board.active)),
    turn_ordinal: board.turn_ordinal ?? null,
  }
}

const fnv1a = (text) => {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Compact console/overlay row. Viewer context is deliberately absent. */
export const fight_fingerprint = (core) => {
  const state = fingerprint_state(core)
  return { turn_ordinal: state.turn_ordinal, hash: fnv1a(JSON.stringify(state)) }
}
