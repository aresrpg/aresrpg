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

import { level_to_experience, experience_to_level } from '@aresrpg/sdk/experience'
import { aresrpg_id } from '@aresrpg/sdk/deployment/aresrpg'

import { context } from '../game/core/game.js'
import { use_auth } from '../auth'
import { get_characters } from '../rpc/client'
import { game_log } from '../core/log.js'
import { DEMO_NETWORK } from '../chain/deployment'

/**
 * Map an indexer RpcCharacter → the flat roster-card shape the engine store + CharactersDrawer render.
 * `class`→`classe`; `experience` is the REAL on-chain field and `level` derives from it via the SDK curve
 * (one home, floors to 1) so the card's xp_progress bar + level read the same truth (a null experience falls
 * back to the level's min-XP + warns). `_type` is stamped from the SSOT type-origin id so the card's max-HP gate
 * treats it as a typed character (on-chain formula). The signed equipment aggregate is already fight-equivalent
 * on the `/v1` wire. Colors/sex ride the RPC row (S-15c), while the avatar hydrate fills appearance chain-direct.
 *
 * EXPORTED (roster /v1 cutover): load_roster.js reuses this SAME mapper as its base identity shape — one
 * home for the RpcCharacter → card mapping, never two drifting copies.
 * @param {import('../rpc/views').RpcCharacter} c
 */
export function rpc_to_card(c) {
  // RpcCharacter carries the REAL on-chain `experience` (S-57) — use it, and DERIVE level from it through the
  // SDK curve (experience_to_level FLOORS to 1: a 0-XP character is level 1, never 0). One derivation home, so
  // the roster card + every HUD level read can never drift. A null `experience` (indexer projection lag — the
  // field is "pending object-snapshot indexing") falls back to the level's min-XP and warns ONCE, never a
  // silent lvl-0. (Was: `experience: level_to_experience(level)` — synthesised from level, discarding the field.)
  let experience = Number(c.experience ?? NaN)
  if (!Number.isFinite(experience)) {
    game_log('roster', 'RpcCharacter missing `experience` — deriving from level (indexer projection lag)', c.id)
    experience = level_to_experience(Math.max(1, Number(c.level ?? 1) || 1))
  }
  const level = experience_to_level(experience)
  const pet_equipped = c.pet_equipped === true
  return {
    id: c.id,
    _type: `${aresrpg_id(DEMO_NETWORK, 'PACKAGE_ID')}::character::Character`,
    name: String(c.name ?? ''),
    classe: String(c.class ?? ''),
    level,
    experience,
    vitality: Number(c.vitality ?? 0),
    wisdom: Number(c.wisdom ?? 0),
    strength: Number(c.strength ?? 0),
    intelligence: Number(c.intelligence ?? 0),
    agility: Number(c.agility ?? 0),
    chance: Number(c.chance ?? 0),
    available_points: Number(c.available_points ?? 0),
    current_hp: c.current_hp == null ? null : Number(c.current_hp),
    hp_updated_ms: c.hp_updated_ms == null ? null : Number(c.hp_updated_ms),
    gear_vitality: c.gear_vitality == null ? null : Number(c.gear_vitality),
    equipment_stats:
      c.equipment_stats == null
        ? null
        : Object.fromEntries(Object.entries(c.equipment_stats).map(([key, value]) => [key, Number(value)])),
    world_id: c.world ?? null,
    jobs: c.jobs ?? {},
    // Keep the read-model's equipped-item projection intact for the Equipment tab. These rows are NOT
    // owner-items: equipped objects have left the loose kiosk-item bag, so dropping this field makes the
    // paper doll look empty whenever the chain-direct enrichment cannot read the kiosk-wrapped character.
    equipment: c.equipment ?? [],
    worn: c.worn ?? {},
    // Carry projection truth only. EquipmentMap owns the boolean and the sibling Item owns identity;
    // the later world lane decides how that pet becomes a companion or mount prompt. False suppresses
    // stale identity, while true + null preserves the honest sibling-snapshot gap.
    pet: pet_equipped ? (c.pet ?? null) : null,
    pet_equipped,
    // WORN COSMETICS (hat/cloak) — the /v1 read-model resolves each equipped cosmetic's category and
    // serves it under `worn` keyed by category; spread it here as the top-level slot fields
    // (character.hat / character.cloak) the render path's resolve_worn_cosmetics reads. Absent → nothing
    // spread (inert + back-compat). load_roster's `{...card, ...chain_read}` merge keeps these (the
    // chain-direct read carries no cosmetic-slot keys, so they survive the enrichment spread).
    ...(c.worn ?? {}),
  }
}

// Single-flight guard (mirrors load_roster): a re-trigger while a fetch is in flight is dropped — the
// in-flight fetch dispatches the up-to-date roster when it lands.
let loading = false

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
