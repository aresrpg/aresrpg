// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// PURE projection: the fight core's committed roster (fight_view().fighters) → the `action/fight_summary/open`
// payload — ONE home for BOTH outcomes. The victory card's DEFEATED-ENEMY block reads the same recap slice as
// the defeat card (FightResult.jsx / FightSummary.jsx both project `summary.participants`); the engine rewrite
// (8c3ec0c → dfa2a51) had narrowed the recap-open to defeats only, so a WIN rendered no enemy rows — the WS-era
// home (fight.js:1124 at 68c8a2f^) opened it on EVERY summary precisely "so the victory card has its full
// roster at once" (v30: "victory card should still show the defeated enemy team"). Source = the session's
// OWN committed roster snapshot, taken before teardown — never a network read.
//
// Split out of dungeon_run_store.js so the mapping is unit-testable headless (the store pulls the whole
// SDK/auth/i18n graph) — the loot-tile-resolve.js idiom.

/**
 * @param {{
 *   fighters: Map<string, { id: string, name: string, team: number, level: number, is_player: boolean,
 *     dead: boolean, owner?: string, variant?: string | null }> | null | undefined,
 *   my_addr: string | null,
 *   my_entity_id?: string | null, // THE SEAT THIS SESSION HELD (engine_view.my_entity_id), captured with the
 *     roster while the fight slice is still live. null = this session held no seat (spectator, or a card opened
 *     for a fight we never joined). #1661: the end-fight cards derive the local row from THIS, never from the
 *     live `selected_character_id` — a character switch after the fight used to make the card render the
 *     currently-selected character as a fallen party member of a fight it never entered.
 *   winner: number,        // winning TEAM index — the player team is 0 (engine_view contract)
 *   xp?: number,           // defeat consolation pool (rides the summary; the win card ignores it)
 *   duration_ms?: number,  // wall-clock fight length (settle time - fight start), when the caller has one.
 *     0 (the default) means no timestamp source exists upstream yet — the card renders no duration rather
 *     than a fake "0:00". SOURCED (recap-truth lane): dungeon_run_store.js captures fight_started_at_ms
 *     locally at fight-bind time (no chain timestamp exists — fight.move's spawned_at_ms is consumed
 *     transiently for aged_bp, never stored) and passes Date.now() - fight_started_at_ms here.
 *   duration_partial?: boolean, // true when fight_started_at_ms was a LATE local observation (resume/poll-
 *     adopt — this client discovered an already-live fight rather than starting/joining it fresh), so
 *     duration_ms UNDERSTATES the true length. The card renders it with a "~" prefix instead of false precision.
 * }} args
 * @returns {{ summary: { winner: number, me_id: string | null, participants: Array<{ id: string, name: string,
 *   label: string, resolved: boolean, team: number,
 *   level: number, is_player: boolean, template_id: string | null, alive: boolean }>, duration_ms: number, duration_partial: boolean,
 *   xp: number, loot: never[], cause: null }, won: boolean }}
 */
export function fight_recap_payload({
  fighters,
  my_addr,
  my_entity_id = null,
  winner,
  xp = 0,
  duration_ms = 0,
  duration_partial = false,
}) {
  const won = winner === 0
  return {
    summary: {
      winner,
      me_id: my_entity_id ?? null,
      participants: [...(fighters?.values() ?? [])].map((f) => ({
        id: f.id,
        // The identity book's applied LABEL, snapshotted with the fact of whether it is a real name (#1993 WP3).
        // A terminal card that carries `resolved: false` knows it is showing an id and can UPGRADE it from a
        // post-fight read; it never has to guess a substitute, which is how the card and the live board used to
        // render one unresolvable fighter under two different names.
        name: f.name,
        label: f.name,
        resolved: !!f.identity_resolved,
        team: f.team,
        level: f.level,
        is_player: f.is_player,
        // The mob's on-chain TEMPLATE id (project.js: variant = view.mobs[].template) — the id the encyclopedia
        // bestiary routes on, so the card's mob rows can deep-link. `f.id` is a fight-scoped seat key ('mob-0'),
        // never an entity identity. Players have no template → null, and the link degrades to plain text.
        template_id: f.variant ?? null,
        // On a DEFEAT the local player is ALWAYS a fallen row, even when a claim/escrow race still says alive
        // (the pre-split behavior, kept verbatim); on a WIN liveness is the core's own truth — beaten enemies
        // read dead → the card's DEFEATED rows, and a fallen-but-carried ally honestly stays a dead row.
        alive: !won && f.is_player && f.owner === my_addr ? false : !f.dead,
      })),
      duration_ms,
      duration_partial,
      xp,
      loot: [],
      cause: null,
    },
    won,
  }
}
