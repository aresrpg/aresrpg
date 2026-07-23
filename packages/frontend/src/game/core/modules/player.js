// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Local scene/UI state the client publishes to the engine store: the player avatar's current
// world cell (for the React Minimap), the tactical fight-mode toggle, and the server's
// authoritative position for OUR character. The scene dispatches `action/player_cell` ONLY when the
// cell changes, so it never fires per-frame; `action/fight_mode` is flipped by core/modules/fight.js
// off the server's fightSpawn/fightsDespawn; `action/local_position` is folded from the server's own-id `characterPosition` broadcast
// (see presence.js) so the roam scene spawns + reconciles to the real position. Pure reducer.

/** @type {import('../game.js').Module} */
export default function player() {
  return {
    /** @param {import('../game.js').State} state @param {import('../game.js').Action} action */
    reduce(state, { type, payload }) {
      switch (type) {
        case 'action/player_cell':
          return { ...state, player_cell: payload }
        case 'action/player_pose':
          // %10-frame throttled pose (position + camera yaw + fps) from the roam frame loop — the
          // CompassStrip's live feed (the old DOM coords/fps chip died with the D188(b)/D199 relocation).
          return { ...state, player_pose: payload }
        case 'action/fight_mode':
          return { ...state, fight_mode: !!payload }
        case 'action/sponsor_upgrade_required':
          // Strict sponsor policy: a client composing a retired package cannot continue safely. This is a
          // one-way session latch; the blocking modal's refresh button obtains a fresh app/package bundle.
          return { ...state, sponsor_upgrade_required: true }
        case 'action/fights_modal':
          // payload: { focus_id } to open (optionally focused on a clicked sword) | null to close
          return { ...state, fights_modal: payload ?? null }
        case 'action/set_visible_fights':
          // The nearby-fights discovery poll (world_fights_discovery.js) reconciles the WHOLE in-range set at
          // once (a Map<fight_id, marker>), replacing the dead WS packet source. FightsModal reads it.
          return { ...state, visible_fights: payload instanceof Map ? payload : new Map() }
        case 'action/set_visible_dungeon_fights':
          // The SAME discovery poll, in a dungeon: my party members' current room-fights (Map<fight_id, row>) for
          // the "team up for the boss" join panel.
          return { ...state, visible_dungeon_fights: payload instanceof Map ? payload : new Map() }
        case 'action/player_menu':
          // payload: { character_id, name, x, y } to open the world social menu | null to close
          return { ...state, player_menu: payload ?? null }
        case 'action/npc_prompt':
          // WS-B: { npc_id, label } when the avatar is in range of the lobby NPC | null when out of range
          return { ...state, npc_prompt: payload ?? null }
        case 'action/dungeons_modal':
          // WS-B: true to open the dungeon browser/create modal shell | false/null to close
          return { ...state, dungeons_modal: !!payload }
        case 'action/commissions_modal':
          // true to open the artisan-commission modal | false/null to close
          return { ...state, commissions_modal: !!payload }
        case 'action/local_position':
          return { ...state, local_position: payload }
        default:
          return state
      }
    },
  }
}
