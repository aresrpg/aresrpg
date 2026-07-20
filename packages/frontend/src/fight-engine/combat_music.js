// FIGHT ENGINE — D111 combat-music gate. A pure derivation of "should the tenser BATTLE bed play right now",
// kept env-free (no store/audio imports) so it is unit-testable in isolation alongside phase.js / chain_frame.js.
//
// ROOT (dungeons): the old combat-music trigger keyed on `action/fight_mode` alone, which the board flips
// TRUE at PLACEMENT / board-mount (dungeon sync_engine dispatches fight_mode=true on the placement spawn; a WS
// fight's spawn does the same) — so the battle track slammed in the instant the placement grid appeared, not
// when the turn fight began. The universal discriminator BOTH flows already carry is the fight slice's
// `placement` flag (dungeon: spawned started:false ⇒ placement:true, flipped false at the PLACEMENT→ACTIVE
// reconcile; WS: placement:!started, flipped false on action/fight/started). So the battle bed plays iff we are
// in fight_mode AND a slice exists AND it is past placement (ACTIVE). Placement / roam keep the ROAM bed (D40).

/**
 * @param {{ fight_mode?: boolean, fight?: { placement?: boolean } | null } | null | undefined} state
 * @returns {boolean} true iff the live BATTLE bed should play (a fight ACTIVE, past the placement window).
 */
export function combat_music_active(state) {
  return !!state?.fight_mode && !!state?.fight && !state.fight.placement
}
