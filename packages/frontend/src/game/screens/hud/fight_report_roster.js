// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure terminal-card roster adapters. Victory and defeat consume the same recap projection, so neither card
// may grow its own field list and silently drop the mob template identity that powers the bestiary link.

/**
 * THE TERMINAL BAR (#1993 WP7, audit row `fight_report_roster.js:27`). A card's HP bar is the recap's EXACT
 * final vitals or it is nothing at all. Converting `alive` into a binary 100/0 percentage stated a number the
 * fight never produced: a party member who limped out of the last room on 7 of 40 hp was drawn at full health.
 * `null` means "no vitals were captured for this row" — the card renders liveness alone, never a filled bar.
 * @param {{ final_hp?: number|null, max_hp?: number|null }} participant
 * @returns {number | null}
 */
const final_hp_pct = ({ final_hp = null, max_hp = null }) => {
  const hp = Number(final_hp)
  const max = Number(max_hp)
  if (final_hp == null || max_hp == null || !Number.isFinite(hp) || !(max > 0)) return null
  return Math.max(0, Math.min(100, (hp / max) * 100))
}

/**
 * @param {Array<{
 *   id: string,
 *   name: string,
 *   team: number,
 *   level: number,
 *   is_player: boolean,
 *   alive: boolean,
 *   final_hp?: number | null,
 *   max_hp?: number | null,
 *   template_id?: string | null,
 * }>} roster
 * @param {number} my_team
 * @returns {Array<{
 *   id: string,
 *   name: string,
 *   level: number,
 *   is_player: boolean,
 *   alive: boolean,
 *   hp_pct: number | null,
 *   template_id: string | null,
 * }>}
 */
export const fight_report_enemy_rows = (roster, my_team) =>
  roster
    .filter((participant) => participant.team !== my_team)
    .map((participant) => ({
      id: participant.id,
      name: participant.name,
      level: participant.level,
      is_player: participant.is_player,
      alive: participant.alive,
      hp_pct: final_hp_pct(participant),
      template_id: participant.template_id ?? null,
    }))
// NOTE (#1993 WP3): enemy rows carry no `label`/`resolved` because they need none — `apply_resolved_names`
// touches PLAYER rows only (`resolvable_row_ids`), and a mob's `name` is already the identity book's applied
// label, which for an unresolved mob IS its template id. Nothing downstream re-decides it.

/**
 * YOUR PARTY rows + the local player's team — the ONE home both end-fight cards project through (victory and
 * defeat differ only by the local row's `self_alive` and which level source they hand in).
 *
 * PARTICIPATION, NEVER SELECTION (#1661): `me_id` is the seat identity the recap CAPTURED while the fight slice
 * was live (`fight_recap.js` → `summary.me_id`), not whichever character the switcher happens to have selected
 * when the card renders. Both older invariants survive, and the lie between them does not:
 *   - a KNOWN seat missing from the roster is still synthesized (a dungeon claim can escrow-remove the dead
 *     player before the recap snapshots) — named off the character that actually held it;
 *   - a roster that raced away EMPTY still renders one local row, but an ANONYMOUS one ("You"), because a
 *     seatless recap knows the session fought without knowing which character did;
 *   - a populated roster is never joined by a phantom row. Naming an uninvolved alt as a fallen party member
 *     was the whole bug: the card read client identity state where it owed the player participation truth.
 *
 * @param {{
 *   roster: Array<{ id: string, name?: string, team: number, level?: number, is_player?: boolean, alive?: boolean,
 *     final_hp?: number | null, max_hp?: number | null }>,
 *   me_id: string | null,
 *   me_name: string | null,
 *   my_level: number,
 *   my_class: string | null,
 *   self_alive: boolean,
 *   fallback_name: string,
 * }} args
 * @returns {{ my_team: number, party_rows: Array<{ id: string, name: string, level: number, is_me: boolean,
 *   is_player: boolean, alive: boolean, hp_pct: number | null, class_name: string | null }> }}
 */
export function fight_report_party_rows({ roster, me_id, me_name, my_level, my_class, self_alive, fallback_name }) {
  const is_local = (participant) => me_id != null && participant.id === me_id
  const my_team = roster.find(is_local)?.team ?? 0
  const seated = roster.filter((participant) => participant.team === my_team)
  // Synthesize the local row for a KNOWN seat the roster lost, or to rescue a roster that raced away empty —
  // never to pad a populated roster with a seat we cannot source.
  const needs_self = !seated.some(is_local) && (me_id != null || seated.length === 0)
  const self_row = { id: me_id ?? 'me', name: me_name ?? fallback_name, team: my_team, level: my_level, is_player: true, alive: self_alive }
  const party = needs_self ? [self_row, ...seated] : seated
  return {
    my_team,
    party_rows: party.map((participant) => {
      // the synthesized row is mine by construction — it must stay `is_me` even when no seat id was captured,
      // or FightReport would try to re-resolve a character name for it and render a short-id instead of "You".
      const mine = participant === self_row || is_local(participant)
      return {
        id: participant.id,
        // the local row is named off the character that HELD THE SEAT; every other row's name is re-resolved by
        // FightReport itself off the ONE character-name home (fight_report_names.js) — this is just its input.
        name: (mine ? me_name : null) || participant.name || fallback_name,
        // FORWARD the identity book's verdict (#1993 WP3). `apply_resolved_names` downstream decides between the
        // carried label and the row's id off THIS flag; dropping it here would make every row look unresolved and
        // re-open the substitute-minting this WP deleted.
        label: participant.label,
        resolved: participant.resolved,
        level: mine ? my_level : participant.level,
        is_me: mine,
        is_player: participant.is_player ?? true, // a party row is always a player; roster rows carry it explicitly
        alive: participant.alive,
        // The synthesized local row carries no vitals by construction (it exists precisely because the roster
        // lost the seat), so it reads null and draws no bar — the honest answer, not a full one.
        hp_pct: final_hp_pct(participant),
        class_name: mine ? my_class : null,
      }
    }),
  }
}
