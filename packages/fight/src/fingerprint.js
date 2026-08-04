// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
//
// Viewer-free divergence fingerprint. This hashes only canonical fold facts, never local identity, prediction,
// pacing, or renderer state. Every viewer of one fight therefore publishes the same digest for the same frontier.

import { mob_entity_id } from './fight_control.js'
import { participant_entity_id } from './participant_identity.js'
import { project_board } from './core_project.js'

const stable_value = (value) => {
  if (Array.isArray(value)) return value.map(stable_value)
  if (typeof value === 'bigint') return value.toString()
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
  return key.startsWith('m') ? mob_entity_id(key.slice(1)) : key
}

/**
 * The one canonical parity image. Every field is viewer-free committed truth: fight outcome/turn facts plus each
 * roster member's identity, position, vitals, readiness, and statuses. Prediction, pacing, and renderer state stay
 * out of the image because two honest viewers may differ on all three.
 */
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
        alive: fighter?.alive ?? null,
        invisible: fighter?.invisible ?? null,
        ap: fighter?.ap ?? null,
        mp: fighter?.mp ?? null,
        ready: fighter?.ready ?? null,
        statuses: (fighter?.statuses ?? [])
          .map(status_image)
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
  return {
    fight_id: core?.fight_id ?? board.fight_id ?? null,
    phase: board.phase ?? null,
    roster,
    active: board.active == null ? null : String(roster_id(view, board.active)),
    turn_ordinal: board.turn_ordinal ?? null,
    turn_deadline_ms: board.turn_deadline_ms ?? null,
    turn_seed_inputs: stable_value(board.turn_seed_inputs ?? null),
    winner: board.winner ?? null,
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
