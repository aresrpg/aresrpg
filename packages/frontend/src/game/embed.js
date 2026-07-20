// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The companion -> game embed entry. Lazily imported by the shell's GameWorldHost on the FIRST
// game-world tab enter (a dynamic import() splits this + the whole game bundle into its own chunk), so
// the engine + WS + Three.js scene boot only when the player opens the world, never at app boot.
//
// Importing this module imports core/game.js (via ./screens/roam.js -> ../store.js), which starts the
// engine's reduce loop. The session bridge is ONE-WAY: the companion auth is the SSOT and hands its
// authenticated session in via action/sui_login; nothing flows back. The roam scene is the REAL
// imperative Three world (terrain + forest + the character sprite), exposing set_paused so the host
// can stop rendering off-tab (drift-#4).

import { context } from './core/game.js'
import { get_last_character } from './core/draft.js'
import { game_log } from '../core/log.js'
import { report_error } from '../core/report.js'

export { context }

/**
 * Pick which roster character to embody: the last-played one (a preference, re-validated against the
 * live on-chain roster so a stale/deleted id can't strand the player), else the first. This is what
 * makes the in-world switcher's hot-swap (persist last-played -> reload) re-enter as the chosen one.
 * @param {any[]} roster
 * @param {string | null} last_id
 * @returns {any | null}
 */
const pick_character = (roster, last_id) => roster.find((c) => c.id === last_id) ?? roster[0] ?? null

/**
 * Resolve the on-chain roster (the sui_data module fetches it on connect), then return the character to
 * embody (last-played, else first). Resolves null on a CONFIRMED-EMPTY roster (sui.loaded with zero
 * characters) or on timeout — the caller renders a decorative world in that case.
 * @param {string | null} last_id
 * @param {number} [timeout_ms]
 * @returns {Promise<any | null>}
 */
function wait_for_character(last_id, timeout_ms = 16000) {
  const now = context.get_state()
  if (now.sui.characters.length > 0) return Promise.resolve(pick_character(now.sui.characters, last_id))
  return new Promise((resolve) => {
    const finish = (value) => {
      clearTimeout(timer)
      context.events.off('STATE_UPDATED', on_update)
      resolve(value)
    }
    const on_update = (state) => {
      if (state.sui.characters.length > 0) finish(pick_character(state.sui.characters, last_id))
      else if (state.sui.loaded) finish(null) // confirmed-empty roster
    }
    const timer = setTimeout(() => finish(pick_character(context.get_state().sui.characters, last_id)), timeout_ms)
    context.events.on('STATE_UPDATED', on_update)
  })
}

/**
 * Pick the active character (last-played, else first), select it locally, and return it. null on a
 * confirmed-empty roster. Selection is chain-direct: `action/select_character` is the single source of
 * truth; the on-chain character carries its own position, and the roam scene reads chain/p2p for peers
 * (no server to ask for "authoritative position + nearby groups").
 * @returns {Promise<any | null>}
 */
export async function select_active_character() {
  const last_id = await get_last_character()
  const chosen = await wait_for_character(last_id)
  if (!chosen) return null
  context.dispatch('action/select_character', chosen.id)
  // NO AUTO-RESUME (S-53): the old boot path auto-called resume_dungeon whenever a roster entry carried an
  // `in_dungeon`/`dungeon_id` tag. That tag came from find_dungeon_characters reading a DEAD old-lineage
  // DungeonRegistry, so a fresh boot teleported the player straight into a stale fight (the blocking
  // bug). A live dungeon/fight is now an OFFERED resume affordance (the picker / NPC / switcher), NEVER an
  // auto-navigate — so this boot path only selects + embodies the character.
  return hydrate_appearance(chosen)
}

/**
 * Hydrate the entered character's APPEARANCE (colors/sex) + full stats with ONE targeted chain-direct read,
 * and fold it back onto the roster so the drawer/HUD read full data too. The S-53 boot roster comes from the
 * RPC indexer, whose record has no colors/sex yet (object-snapshots pending), but the avatar needs them AT
 * MOUNT. This reads JUST the character being embodied — never a scan of all kiosks. Idempotent: a character
 * that already carries `color_1` (a chain-direct producer, e.g. a post-tx reconcile) is returned untouched.
 * Non-fatal: on a failed read the class-default avatar still renders (the caller mounts with the RPC card).
 * @param {any} chosen @returns {Promise<any>}
 */
async function hydrate_appearance(chosen) {
  if (chosen?.color_1 != null) return chosen // already chain-hydrated (has appearance)
  try {
    const [{ get_sdk }, { read_character }] = await Promise.all([
      import('../chain/sdk'),
      import('../chain/read_character.js'),
    ])
    const { grpc_client } = await get_sdk()
    const full = await read_character(grpc_client, chosen.id)
    // M5: appearance/stats are an ENRICHMENT input — the reducer merges cosmetics/stats but PRESERVES any
    // newer receipt-proven fact (XP/level/HP), which the immutable chain base would otherwise clobber (RED#3).
    context.dispatch('action/sui_data', { kind: 'enrichment', character_id: chosen.id, enrichment: full })
    return { ...chosen, ...full, experience: chosen.experience, level: chosen.level }
  } catch (error) {
    game_log('game-world', 'appearance hydrate failed — class-default avatar', error)
    return chosen
  }
}

/**
 * Mount the REAL roam scene into `host` and return its lifecycle controls. With a selected character
 * it renders that character's class sprite in the live world; with none it renders a decorative live
 * world (no avatar). In `spectate` mode the camera is anchored on the world origin and the scene is a
 * DECORATIVE backdrop only — no live feed (the spectate WS dial was removed; the p2p live-world spectate
 * feature returns at #19). The polished in-world HUD is design's pending P2-visual.
 * In `follow` mode the avatar is the chosen character's class GLB and it idle-WANDERS its world (the
 * camera trails it) — the idle-exploration "follow a character" focus; the world's biome music is owned by
 * the follow store (src/follow.ts), not here.
 * @param {HTMLElement} host
 * @param {any | null} [character]
 * @param {{ spectate?: boolean, follow?: boolean }} [opts]
 * @returns {{ set_paused: (paused: boolean) => void, destroy: () => void }}
 */
export function mount_scene(host, character = null, { spectate = false, follow = false } = {}) {
  // D139 CUTOVER: the voxel engine IS the renderer — the isometric roam stack is DELETED (by design;
  // the in-engine ENG-20 WebGL floor is the low-end fallback, so no app-side second renderer exists). The
  // engine chunk stays DYNAMIC-imported so the login/menu bundle never carries WebGPU code; a thin proxy
  // forwards set_paused/destroy until the chunk resolves. `spectate`/`follow` ride into the voxel scene
  // (decorative camera modes are engine-side concerns; the adapter ignores them until those modes land).
  /** @type {{ set_paused: (p: boolean) => void, destroy: () => void } | null} */
  let real = null
  let destroyed = false
  let paused = false
  void import('./embed_voxel.js')
    .then(({ mount_voxel_scene }) => {
      if (destroyed) return
      real = mount_voxel_scene(host, character, { spectate, follow })
      real.set_paused(paused) // apply any pause that arrived before the chunk loaded
    })
    .catch((error) => {
      game_log('game-world', 'voxel scene load failed', error)
      report_error(error, { area: 'game-world', action: 'voxel_scene_load' })
    })
  return {
    set_paused: (p) => {
      paused = p
      real?.set_paused(p)
    },
    destroy: () => {
      destroyed = true
      real?.destroy()
    },
  }
}
