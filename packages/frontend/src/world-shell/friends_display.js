// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE friend-row name derivation (a raw address slice was leaking onto freshly-added friends —
// OnlinePlayers' FriendRow fell back through rpc/use_address_names + components/address_name's SuiNS/truncated-
// address chain, a SECOND resolution path parallel to character_name_resolve.js's ONE HOME for id→name display).
// Kept as its own dependency-light pure module (mirrors fight_area_panel.js's split from its heavy .jsx host) so
// it unit-tests without booting OnlinePlayers.jsx's transitive auth/p2p/store import graph.

import { short_fighter_id } from './character_name_resolve.js'

/**
 * CANONICAL IDENTITY WINS (realtime constitution D2). A name is identity, and identity is an authority
 * question — so the /v1 character name friends_reads.read_roster resolved (the SAME get_characters primitive
 * the ONE HOME itself reads, just queried by owner address instead of character id) is the only name this row
 * shows, and the home's own honest fallback covers the rest. A peer's self-declared name is an observation
 * and used to be preferred here as "the freshest signal"; freshness is not authority, so it is gone rather
 * than demoted — a second, unverified name beside the real one is a question no player asked.
 * Never invents a name, never a bespoke truncation for this surface. Pure — no IO.
 * @param {{ address: string, name: string | null }} row
 * @returns {string}
 */
export function friend_display_name(row) {
  return row?.name || short_fighter_id(row?.address)
}

/**
 * The friend row's presence STATE — the advisory-only law (realtime constitution D2) made mechanical here.
 * "Is this friend online?" is an authority question and this surface holds nothing that answers it, so there
 * is no boolean to derive: only two separately-labelled observations, and this reports which one we hold.
 *   'seen'   — a peer observation for this wallet exists in my session right now (advisory, this instant)
 *   'recent' — nobody is observing them, but the read layer's last-known position for them is fresh
 *   'unseen' — neither fact is present. UNKNOWN — never "offline". Pure — no IO.
 * @param {{ observed?: boolean, position_fresh?: boolean }} facts
 * @returns {'seen'|'recent'|'unseen'}
 */
export function friend_presence_state({ observed, position_fresh } = {}) {
  if (observed) return 'seen'
  return position_fresh ? 'recent' : 'unseen'
}
