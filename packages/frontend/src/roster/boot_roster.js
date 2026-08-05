// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RPC-sourced BOOT roster (S-53). The first roster load on a game-world / characters enter reads the
// player's characters in ONE call to the read-API indexer (GET /v1/characters?owner=…) instead of the
// multi-second chain-direct kiosk+stake+dungeon scan load_roster runs. Two owner-blocking wins:
//   • FAST: one indexed GET (<1s) resolves create-vs-roster, vs the old 6-7s four-way chain scan.
//   • NO TELEPORT: the RPC record carries no `in_dungeon` tag. The old scan read a DEAD old-lineage
//     DungeonRegistry (0x48e0c3c7…, deleted in an old-registry split) and tagged a stale escrowed
//     character `in_dungeon`; select_active_character then auto-resumed it → a teleport into an old
//     fight. The RPC roster cannot produce that tag, so the boot path can no longer teleport.
//
// The RPC record carries the effective world-read inputs too: allocated stats, HP state, and the exact signed
// equipment aggregate. The mapper normalizes that projection so the fast card already feeds the world HUD;
// the AVATAR of the character actually entered is hydrated with ONE targeted chain-direct read in game/embed.js
// (never a scan of all kiosks). A background, non-blocking load_roster() runs AFTER the fast dispatch to hydrate
// the loose-item bag + remaining chain-only fields/live stakes and to
// self-heal any indexer lag — it can no longer teleport (find_dungeon_characters is gone). The
// <1s roster load is the RPC call alone.

import { context } from '../game/core/game.js'
import { use_auth } from '../auth'
import { get_characters } from '../rpc/client'
import { game_log } from '../core/log.js'
import { get_sdk } from '../chain/sdk'
import { get_personal_caps } from '../chain/kiosk_cap_cache.js'

import { rpc_to_card } from './roster_projection.js'

export { rpc_to_card } from './roster_projection.js'

// Single-flight guard (mirrors load_roster): a re-trigger while a fetch is in flight is dropped — the
// in-flight fetch dispatches the up-to-date roster when it lands.
let loading = false
let kiosk_caps_pre_warmed = false

/**
 * Boot the roster from the RPC indexer in ONE call, dispatch it onto the engine store, and auto-select the
 * first character (the HUD/chat need a valid id). Empty roster → the CREATE screen (confirmed-empty).
 * Non-empty → cards from the RPC record. An RPC FAILURE surfaces load_error (→ Retry) and leaves `loaded`
 * false so it is NEVER mistaken for a confirmed-empty create. A background load_roster() then hydrates the
 * bag + full stats without blocking (and is the chain-direct fallback when the RPC read failed).
 * @returns {Promise<void>}
 */
export async function boot_roster() {
  const { address } = use_auth.getState()
  if (!address || loading) return
  loading = true
  try {
    const rpc_chars = await get_characters({ owner: address })
    const characters = rpc_chars.map(rpc_to_card)
    // Mirror sui_data.js / load_roster's dispatch shape (single home: the sui_session reducer spreads this
    // onto state.sui). `loaded: true` flips the drawer out of loading; `load_error: null` clears prior errors.
    context.dispatch('action/sui_data', {
      characters,
      has_claimed_free_character: characters.length > 0,
      loaded: true,
      load_error: null,
    })
    if (!kiosk_caps_pre_warmed) {
      kiosk_caps_pre_warmed = true
      void get_sdk()
        .then((sdk) => get_personal_caps(sdk, address))
        .catch((error) => game_log('boot_roster', 'engage kiosk-cap pre-warm failed', error))
    }
    if (!context.get_state().selected_character_id && characters[0]?.id)
      context.dispatch('action/select_character', characters[0].id)
  } catch (error) {
    game_log('boot_roster', 'RPC roster load failed', error)
    // No false create on a failed read (mirror load_roster's degraded law): leave `loaded` untouched and
    // surface Retry only before the first success — once a roster is on screen a transient re-fetch hiccup
    // must not blow it away. The background load_roster below is the chain-direct fallback.
    if (!context.get_state().sui.loaded)
      context.dispatch('action/sui_data', { load_error: 'Could not load your characters. Retry.' })
  } finally {
    loading = false
  }

  // BACKGROUND HYDRATE (non-blocking, after the fast roster): the loose-item bag + full character stats/
  // colors + live stakes come from the chain-direct load_roster (teleport-safe now — find_dungeon_characters
  // removed). Also self-heals indexer lag (a lagging RPC empty is corrected by chain truth, which flips the
  // create screen back to the real roster). Never awaited — the <1s roster load is the RPC call above.
  void import('./load_roster')
    .then(({ load_roster }) => load_roster())
    .catch((error) => game_log('boot_roster', 'background hydrate failed', error))
}
