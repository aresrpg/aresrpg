// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE RESUME CONSENT (#1751 / #1757 → #2122) — what answers for a chain-live seat this client is not mounting.
//
// Measured (#1751): every boot onto a chain-seated character re-entered through the dialog-less create-adopt path,
// and the entry's liquidation door then COMMITTED the overdue turn — one real gas-burning transaction per boot
// (five boots, five transactions, no player action anywhere), and the stranded-fight lifecycle advanced toward a
// resolution nobody chose (the QA seat resolved as a DEFEAT the player never picked). The answer then was a DOOR:
// a modal, asked before anything was composed.
//
// #2122 INVERTS THE HAPPY PATH, and only the happy path (owner ruling): a player who crashed mid-fight wants their
// fight back, not a dialog, so the FIRST pass at a given fight this session answers 'rejoin' ITSELF. What is NOT
// readmitted is the defect class behind that door:
//   · the five-boots loop is capped at ONE autonomous attempt per fight id per session (`auto_attempted` below).
//     A second pass at the same fight can only mean the first did not end in a mounted session — the entry
//     refuses outright while a session is live — so it PARKS ON THE MODAL, where the player holds forfeit/later;
//   · nothing here ever answers 'forfeit'. The auto answer is 'rejoin' or nothing, so the DEFEAT nobody chose is
//     reachable from no automatic path;
//   · the autonomous answer is TRACED (`fight_resume_auto`) — a transaction no human pressed must stay legible.
// The modal is therefore the FAILURE FALLBACK, unchanged in every other respect.
//
// This module is that consent's state — ONE pending offer, the choice that answers it, and the per-session memory
// of which fights already spent their autonomous attempt. The ASKING side (world_fight.js's entry) awaits
// `consent_fight_resume`; the ANSWERING side (FightResumeOffer.jsx) calls `choose_fight_resume`.
// Framework-agnostic (an EventEmitter + a snapshot, the toast-store idiom) so the entry can park on it without
// React, and the whole exchange is on the fight trace rail
// (`fight_resume_auto` | `fight_resume_offer` → `fight_resume_choice`).
//
// 'later' is the ESCAPE-HATCH answer, and it is deliberately the default for a dismissal: a stray Escape may
// never forfeit a fight. It commits nothing, mounts nothing, and the next boot pass asks again.

import { EventEmitter } from 'events'

import { fight_state_trace } from './fight_state_trace.js'

/** @typedef {'rejoin' | 'forfeit' | 'later'} ResumeChoice */
/** @typedef {{ fight_id: string, character_id: string, action: 'crank' | 'force_start', deadline_ms: number }}
 *   ResumeOffer */

const emitter = new EventEmitter()
/** @type {ResumeOffer | null} */
let offer = null
/** @type {((choice: ResumeChoice) => void) | null} */
let answer = null
/** Fight ids that already spent their ONE autonomous rejoin this page session (#2122). Module-level and
 *  page-scoped on purpose: a reload is a fresh player intent, and its first pass is autonomous again. */
const auto_attempted = new Set()

const emit = () => emitter.emit('change')

/** The pending offer, for React (useSyncExternalStore) and for a headless caller alike. */
export const fight_resume_offer_store = {
  /** @returns {ResumeOffer | null} */
  get: () => offer,
  /** @param {() => void} cb @returns {() => void} */
  subscribe: (cb) => {
    emitter.on('change', cb)
    return () => emitter.off('change', cb)
  },
}

/**
 * CONSENT (#2122) — the entry's answer for a seat it is not mounting. The first pass at this fight this session
 * answers 'rejoin' immediately: the held fight comes back by itself, no dialog. Every pass after it falls back to
 * the modal, so the fight's autonomous spend is capped at one and the player owns every decision from there.
 * @param {ResumeOffer} pending
 * @returns {Promise<ResumeChoice>}
 */
export function consent_fight_resume(pending) {
  if (auto_attempted.has(pending.fight_id)) return offer_fight_resume(pending)
  auto_attempted.add(pending.fight_id)
  fight_state_trace('fight_resume_auto', pending)
  return Promise.resolve(/** @type {ResumeChoice} */ ('rejoin'))
}

/**
 * ASK. Park the offer and resolve with the player's answer. A second offer while one already stands answers
 * 'later' immediately (never two questions about two fights at once — the first one still owns the screen).
 * Deliberately NOT exported: `consent_fight_resume` is the entry's one way in, so nothing can reach the modal
 * while skipping the autonomous attempt — or reach a transaction while skipping the cap that bounds it.
 * @param {ResumeOffer} pending
 * @returns {Promise<ResumeChoice>}
 */
function offer_fight_resume(pending) {
  if (offer) {
    fight_state_trace('fight_resume_offer_superseded', { fight_id: pending.fight_id, standing: offer.fight_id })
    return Promise.resolve(/** @type {ResumeChoice} */ ('later'))
  }
  offer = { ...pending }
  fight_state_trace('fight_resume_offer', pending)
  emit()
  return new Promise((resolve) => {
    answer = resolve
  })
}

/**
 * ANSWER. Clears the offer and hands the choice to whoever is awaiting it. A choice with no standing offer is a
 * no-op (a double-click on the dialog's own button).
 * @param {ResumeChoice} choice
 * @returns {ResumeOffer | null} the offer this answered
 */
export function choose_fight_resume(choice) {
  if (!offer) return null
  const answered = offer
  const resolve = answer
  offer = null
  answer = null
  fight_state_trace('fight_resume_choice', { fight_id: answered.fight_id, action: answered.action, choice })
  emit()
  resolve?.(choice)
  return answered
}

/** Drop a standing offer on teardown (a session ended under it) — answers 'later', commits nothing — and forget
 *  which fights spent their autonomous attempt: that memory belongs to the session that just ended. */
export function reset_fight_resume_offer() {
  if (offer) choose_fight_resume('later')
  auto_attempted.clear()
}
