// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE friend-row name derivation (a raw address slice was leaking onto freshly-added friends —
// OnlinePlayers' FriendRow fell back through rpc/use_address_names + components/address_name's SuiNS/truncated-
// address chain, a SECOND resolution path parallel to character_name_resolve.js's ONE HOME for id→name display).
// Kept as its own dependency-light pure module (mirrors fight_area_panel.js's split from its heavy .jsx host) so
// it unit-tests without booting OnlinePlayers.jsx's transitive auth/p2p/store import graph.

import { short_fighter_id } from './character_name_resolve.js'

/**
 * Precedence: the live p2p peer's self-declared name (D222, freshest signal) → the /v1 character name
 * friends_reads.read_roster already resolved (the SAME get_characters primitive the ONE HOME itself reads,
 * just queried by owner address instead of character id) → the home's own honest fallback. Never invents a
 * name, never a bespoke truncation for this surface. Pure — no IO.
 * @param {{ address: string, name: string | null }} row
 * @param {{ name?: string | null } | null | undefined} peer
 * @returns {string}
 */
export function friend_display_name(row, peer) {
  return peer?.name || row?.name || short_fighter_id(row?.address)
}
