// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIGHT ENGINE — D111 combat-music gate. A pure derivation of "should the tenser BATTLE bed play right now",
// kept env-free (no store/audio imports) so it is unit-testable in isolation alongside phase.js / chain_frame.js.
//
// ROOT (dungeons): the old combat-music trigger keyed on `action/fight_mode` alone, which the board flips
// TRUE at PLACEMENT / board-mount — so the battle track slammed in before the turn fight began. `placement`
// normally distinguishes that setup window, but it is a lagging projection: READY can land and publish an
// active fighter while the bit remains stale-TRUE until the next snapshot. The phase machine already resolves
// that divergence by taking forward progress; this music door does the same with `active_entity_id`. Placement
// with no actor keeps the roam bed, while either a cleared placement bit or a live actor selects battle.

/**
 * @param {{ fight_mode?: boolean, fight?: { placement?: boolean, active_entity_id?: string | null } | null } | null | undefined} state
 * @returns {boolean} true iff the live BATTLE bed should play (a fight ACTIVE, past the placement window).
 */
export function combat_music_active(state) {
  return (
    !!state?.fight_mode && !!state.fight && (state.fight.placement !== true || state.fight.active_entity_id != null)
  )
}
