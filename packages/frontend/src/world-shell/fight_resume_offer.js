// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE RESUME DOOR (#1751 / #1757) — a chain-live seat this client is not mounting is the PLAYER's call.
//
// Measured: every boot onto a chain-seated character re-entered through the dialog-less create-adopt path, and the
// entry's liquidation door then COMMITTED the overdue turn — one real gas-burning transaction per boot (five boots,
// five transactions, no player action anywhere), and the stranded-fight lifecycle advanced toward a resolution
// nobody chose (the QA seat resolved as a DEFEAT the player never picked). A player who crashes mid-fight is the
// same orphan and needs the same thing: a DOOR, not an autonomous transaction.
//
// This module is that door's state — ONE pending offer, and the choice that answers it. The ASKING side
// (world_fight.js's entry) awaits `offer_fight_resume`; the ANSWERING side (FightResumeOffer.jsx) calls
// `choose_fight_resume`. Framework-agnostic (an EventEmitter + a snapshot, the toast-store idiom) so the entry can
// park on it without React, and the whole exchange is on the fight trace rail
// (`fight_resume_offer` → `fight_resume_choice`) where the round-4 drive proved no resume event existed at all.
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
 * ASK. Park the offer and resolve with the player's answer. A second offer while one already stands answers
 * 'later' immediately (never two questions about two fights at once — the first one still owns the screen).
 * @param {ResumeOffer} pending
 * @returns {Promise<ResumeChoice>}
 */
export function offer_fight_resume(pending) {
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

/** Drop a standing offer on teardown (a session ended under it) — answers 'later', commits nothing. */
export function reset_fight_resume_offer() {
  if (offer) choose_fight_resume('later')
}
