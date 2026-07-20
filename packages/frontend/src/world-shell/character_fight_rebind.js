// CHARACTER↔WORLD SESSION BINDING (v33) — the FIGHT half of an active-character switch, as a PURE
// decision with its effects INJECTED at the edge (CLIENT-INDEPENDENCE: effects live at the edges, the core
// computes). The world scene re-keys off the session gate (session_gate.js); the fight board mounts off
// `use_dungeon.dungeon_id`, which is whoever STARTED the fight — so a switch must ALSO rebind the fight, or
// char A's board stays up over char B's world (a live bug: "forced to remain on the first character fight").
//
// Char A's fight is NEVER abandoned/forfeited (no on-chain tx): reset_local drops only THIS client's local
// mirror; the on-chain Fight persists, re-enterable when A becomes active again (resume reads it back on
// switch-back). CharacterSwitcher wires `dungeon` / `reset_local` (use_dungeon) and `resume` (resume_world_fight).

/**
 * Rebind the local fight session to the freshly-active character.
 * @param {string} character_id the now-active character
 * @param {{ dungeon: { dungeon_id: string|null, character_id: string|null },
 *           reset_local: () => void, resume: (id: string) => any }} edges
 */
export function rebind_fight_session(character_id, { dungeon, reset_local, resume }) {
  // Tear down only when a DIFFERENT character's board is live — same-character (or no board) is a no-op, so the
  // fight-rebind is safe on EVERY switch (lobby↔lobby included: reset_local skipped, resume no-ops chain-side).
  if (dungeon.dungeon_id && dungeon.character_id && dungeon.character_id !== character_id) reset_local()
  return resume(character_id)
}
