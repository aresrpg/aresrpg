// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE AUTONOMOUS RESUME (#1751 / #1757 → #2122 → D48) — what answers for a chain-live seat this client is not
// mounting. Three eras, and the whole story matters, because each one closed a defect the next must not reopen.
//
// ERA 1 — THE DOOR (#1751/#1757). Measured: every boot onto a chain-seated character re-entered through the
// dialog-less create-adopt path, and the entry's liquidation door then COMMITTED the overdue turn — one real
// gas-burning transaction per boot (five boots, five transactions, no player action anywhere) — while the
// stranded fight's lifecycle advanced toward a resolution nobody chose (the QA seat resolved as a DEFEAT the
// player never picked). The answer was a MODAL: rejoin / forfeit / later, asked before anything was composed.
//
// ERA 2 — THE CAPPED AUTO-ANSWER (#2122). A player who crashed mid-fight wants their fight back, not a dialog,
// so the first pass at a given fight each session answered 'rejoin' itself. The modal survived as the FAILURE
// FALLBACK, reached once a fight had spent its one autonomous attempt, and the burn was bounded by that count.
//
// ERA 3 — D48, WHICH SUPERSEDES BOTH (owner ruling). Fight presence is BINARY: a refresh AUTO-RESUMES, and the
// only exits from a fight are death and surrender. There is no third state, therefore no dialog, no prompt and
// no held seat waiting on a human — a player standing in the overworld holding a question about a fight they
// are still in IS the held state the ruling abolishes. So the modal is deleted, 'later' and 'forfeit' are gone
// as answers here (surrender lives INSIDE the mounted fight — FightControls.jsx), and the per-session cap that
// existed only to route into that modal goes with it: EVERY candidacy answers 'rejoin'.
//
// WHAT BOUNDS THE BURN NOW — the CANDIDACY CADENCE, not a counter. A candidacy is a deliberate (re-)entry, and
// there are exactly two producers: the spawns adapter fires `resume_world_fight` once per bound world
// (world_spawns.js's `resumed` one-shot — so boot, world entry and travel are one candidacy each), and a
// character switch fires it once for the incoming character (character_switch.js). Nothing loops within a
// session tick. Each candidacy then composes AT MOST ONE liquidation transaction: `ensure_resumable_fight`
// fires each door once per pass and never re-sends one that executed (the tx-retry burn law). So a fight that
// cannot be healed costs one attempt per deliberate re-entry — exactly the rate at which the player is asking
// for it back — and #1751's five-boots-five-transactions loop cannot return as a defect, because there each
// boot spent a transaction nobody asked for, where here each is the player's own renewed request.
//
// The DEFEAT-nobody-chose class stays closed by mechanism, not by counting: this path answers ONLY 'rejoin', so
// no automatic path can abandon a seat, and an answer that lands MOUNTS the fight — which is precisely what
// puts a human back in front of the surrender door. The answer is TRACED (`fight_resume_auto`): a transaction
// no human pressed must stay legible.

import { fight_state_trace } from './fight_state_trace.js'

/** @typedef {{ fight_id: string, character_id: string, action: 'crank' | 'force_start', deadline_ms: number }}
 *   ResumeCandidacy */

/**
 * CONSENT (D48) — the entry's answer for a chain-live seat it is not mounting. It is always 'rejoin': the fight
 * is the player's, and the only alternatives the ruling leaves are death and surrender, neither of which a boot
 * may choose on their behalf. Stateless on purpose — the burn bound lives in the candidacy cadence documented
 * above, never in a counter this module would have to remember (and get wrong across a character switch).
 * @param {ResumeCandidacy} candidacy
 * @returns {'rejoin'}
 */
export function consent_fight_resume(candidacy) {
  fight_state_trace('fight_resume_auto', candidacy)
  return 'rejoin'
}
