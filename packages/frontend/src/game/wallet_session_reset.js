// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// WALLET-SWITCH SESSION RESET (P0/D286) — the ONE authority that tears a wallet session down.
//
// The bug: a player disconnects account A and connects account B, but keeps controlling A's character. The
// roster read is wallet-scoped (D245), but the SESSION layer survives the account change. Concretely, on the
// chain-direct build the engine's `action/sui_logout` was NEVER dispatched (dead reducer) — so on a switch the
// engine still held A's `selected_character_id` + A's `sui.characters`, and when B's lobby scene remounted,
// embed.js's select_active_character → wait_for_character read A's STALE roster (length > 0) and re-picked A's
// character before B's roster ever loaded. The dungeon session (in_session/session_address) and the p2p lobby
// identity (my_character_id) likewise lingered as A.
//
// The single home (one system, one flow, one home per piece of logic): GameWorldHost observes the
// auth address and, on ANY change away from a previous NON-NULL address (disconnect A→null, or a direct A→B
// switch), calls this. First connect (null→A) never runs it, so a plain boot is untouched. Everything here is a
// LOCAL reset — no on-chain tx (the char of account A stays wherever it is on-chain; chain ownership is
// unaffected). The scene remount + B's fresh roster load are driven by GameWorldHost's existing effects; this
// only clears the stale session state they read.
//
// Kept OUT of auth/index.ts (the eager login bundle) on purpose: it statically imports the game engine + world
// stores, which must stay in the lazily-booted game chunk. GameWorldHost dynamic-import()s this, so it only
// loads once the player has already booted the game (i.e. was logged in) — never on the login screen.

import { character_switch_store } from '@aresrpg/world/character_selection'

import { context } from './core/game.js'
import { use_dungeon } from '../world-shell/dungeon_store.js'
import { use_party } from '../world-shell/party_store.js'
import { use_expedition } from '../roster/store'
import { leave_room } from '../p2p/lobby-room.js'
import { invalidate as invalidate_kiosk_cap_cache } from '../chain/kiosk_cap_cache'

/** @typedef {{ type: 'wallet_session/reset' }} WalletSessionInput */

/**
 * Tear the whole wallet session down so the NEXT account starts clean. Idempotent — safe to call when nothing is
 * active (an empty dungeon reset / a never-joined lobby are no-ops), so a stray double-fire can't misbehave.
 * @param {WalletSessionInput} [input]
 */
export function reset_wallet_session(input = { type: 'wallet_session/reset' }) {
  if (input.type !== 'wallet_session/reset') return

  // 0. CHARACTER SWITCH — release the shared in-flight door and invalidate its correlated request id before any
  //    outgoing async continuation can commit selection into the next wallet session.
  character_switch_store.getState().input({ type: 'reset' })

  // 1. ENGINE session — clear the selected character + the roster (+ reset loaded/load_error), so B's
  //    select_active_character waits for B's roster instead of re-resolving A's. Reuses the sui_logout reducer
  //    (this is its only live caller).
  context.dispatch('action/sui_logout')

  // 2. DUNGEON session — drop the LOCAL session (stop polling + tear the fight/plane engine down + in_session:false)
  //    via the store's own no-tx reset. NOT abandon/burn (those fire on-chain txs): A's escrowed char stays in its
  //    Den on-chain; this only stops THIS client mirroring it so B never inherits A's dungeon board.
  use_dungeon.getState().reset_local()

  // 3. PARTY presence — clear the client-only party_id/party (+ leave the party chat room). party_id rides the p2p
  //    `state` broadcast, so a stale A party_id would re-announce under B the next time B crosses a dungeon
  //    boundary (party_store re-publishes on dungeon_id delta). B relearns its own party via the invite nudge.
  use_party.getState().reset_local()

  // 4. Realtime transition — close A's room membership so peers receive A's departure before B announces.
  leave_room()

  // 5. EXPEDITION store (S-19a — the gap this closes) — the character / kiosk / personal-kiosk-cap + active-run
  //    mirror that the in-world HUD reads (GameWorldHud / SelfPlate / CharacterMenu). It is wallet-scoped but
  //    SURVIVED the account change (nothing reset it), so B's HUD kept showing A's character/kiosk/run. Reset it
  //    to its initial shape through the store's typed input/reducer door; B's next load_character
  //    (GameWorldHost's roster/scene effects) repopulates it for the new account.
  use_expedition.getState().input({ type: 'wallet_session/reset' })

  // 6. KIOSK-CAP CACHE (getOwnedKiosks is cached once per wallet) — drop the outgoing account's
  //    cached PersonalKioskCap so a switch never serves A's cap to B's gift/listing/marketplace writes.
  invalidate_kiosk_cap_cache()
}
