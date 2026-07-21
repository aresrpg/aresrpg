// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/**
 * Whether a peer's avatar belongs in MY render instance — INSTANCE scope only, never distance (remote_players.js
 * layers its own overworld range gate on top of this). #333: dungeon_id is each character's PERSONAL
 * run_pass_id (dungeon_run_store.js "session identity") — never equal between two different players, not even
 * two co-op partners standing in the exact same room, so it can never gate cross-player visibility (same disease
 * PR #330 cured in the chat scope — world_chat_scope.js).
 *
 * Two players share a render instance when:
 *   - both stand in the open world (dungeon_id null on both sides) — one continuous world; range decides the rest.
 *   - both stand in a dungeon AND belong to the SAME accepted on-chain party (party_id — broadcast in every
 *     low-frequency p2p `state`, lobby-room.js broadcast_state / party_store.js _publish_state). party_id is the
 *     one identity genuinely SHARED between real co-op partners, unlike the personal run_pass_id. Every dungeon
 *     cave reuses the same local room coordinates (cave_session.js seeds off world_id — "co-op consistent, same
 *     world, same room"), so a stranger running the identical dungeon TEMPLATE without being in my party must
 *     still never render as a ghost standing in my room — D237's original invariant, preserved here on a value
 *     that is actually shared instead of a personal one that never matches anybody.
 * @param {{ mine_dungeon_id: string|null, peer_dungeon_id: string|null, mine_party_id: string|null, peer_party_id: string|null }} scope
 * @returns {boolean}
 */
export function same_render_instance({ mine_dungeon_id, peer_dungeon_id, mine_party_id, peer_party_id }) {
  const mine_in_dungeon = mine_dungeon_id != null
  const peer_in_dungeon = peer_dungeon_id != null
  if (!mine_in_dungeon && !peer_in_dungeon) return true // both overworld — one continuous world
  if (mine_in_dungeon !== peer_in_dungeon) return false // one's in a private room, the other isn't — never co-located
  return !!mine_party_id && mine_party_id === peer_party_id // same cave room = same accepted party, chain truth
}
