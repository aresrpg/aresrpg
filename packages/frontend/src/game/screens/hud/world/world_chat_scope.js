// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/**
 * Whether a chat line belongs in the current world/fight log — ALWAYS true (#306). Chat rides the shared zone
 * channel and has ZERO fight/dungeon awareness: a fighter (or anyone inside a dungeon) stays a member of the
 * exact same log a roamer reads. This used to also gate general/commerce lines behind a peer-vs-mine
 * `dungeon_id` match, but that id is each character's PERSONAL run_pass_id — the "session identity" alias in
 * dungeon_run_store.js, never a shared instance id — so the match never held between two different players,
 * not even two co-fighters standing side by side in the exact same fight. A fighter's general-channel lines
 * silently vanished for every roamer, and for any ally whose own client wasn't independently mid-fight at that
 * instant. Kept as its own seam (not inlined) so the invariant stays headless-testable — see the test file.
 * remote_players.js still compares dungeon_id for 3D avatar visibility; that's a separate, unrelated concern.
 * @param {{from_me?:boolean,channel?:string}} [line]
 * @returns {true}
 */
export function chat_line_in_scope(line) {
  return true
}
