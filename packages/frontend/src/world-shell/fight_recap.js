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
 *     dead: boolean, owner?: string }> | null | undefined,
 *   my_addr: string | null,
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
 * @returns {{ summary: { winner: number, participants: Array<{ id: string, name: string, team: number,
 *   level: number, is_player: boolean, alive: boolean }>, duration_ms: number, duration_partial: boolean,
 *   xp: number, loot: never[], cause: null }, won: boolean }}
 */
export function fight_recap_payload({ fighters, my_addr, winner, xp = 0, duration_ms = 0, duration_partial = false }) {
  const won = winner === 0
  return {
    summary: {
      winner,
      participants: [...(fighters?.values() ?? [])].map((f) => ({
        id: f.id,
        name: f.name,
        team: f.team,
        level: f.level,
        is_player: f.is_player,
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
