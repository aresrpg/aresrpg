// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { chain_to_client_coordinate } from '@aresrpg/immutable'
import { FIGHT_VIEW_RADIUS_BLOCKS } from '@aresrpg/protocol'

import { pose_matches_character, type WorldPose } from '../game/core/pose_feed.ts'
import type { AppState } from '../store.ts'

import { sword_fights } from './world_engage.ts'
import type { FightSessionState } from './fight.ts'

export type NearbyFight = Readonly<{ character_id: string; fight: string }> | null

/** One stable nearby board. Staying in range never switches streams just because another is closer. */
export const nearby_fight = (state: Readonly<AppState>, pose: WorldPose | null): NearbyFight => {
  const character = state.session.characters.find(({ id }) => id === state.session.selected_character_id)
  if (!character || !pose_matches_character(pose, character.id)) return null
  if (
    [
      state.session.link_status !== 'ready',
      state.navigation.page !== 'world',
      state.fight.mounted,
      !!character.active_fight,
      !!character.dungeon_run,
    ].includes(true)
  )
    return null
  const candidates = sword_fights(state.world.fights, character.world ?? null)
    .map((fight) => ({
      fight: fight.id,
      distance: Math.hypot(chain_to_client_coordinate(fight.x) - pose.x, chain_to_client_coordinate(fight.z) - pose.z),
    }))
    .filter(({ distance }) => distance <= FIGHT_VIEW_RADIUS_BLOCKS)
  const retained =
    state.fight.nearby?.character_id === character.id
      ? candidates.find(({ fight }) => fight === state.fight.nearby?.fight)
      : undefined
  const chosen = retained ?? candidates.toSorted((a, b) => a.distance - b.distance || a.fight.localeCompare(b.fight))[0]
  return chosen ? { character_id: character.id, fight: chosen.fight } : null
}

/** Reuse the ordinary fight presentation without projecting it into the selected character's fight. */
export const nearby_fight_view = (fight: FightSessionState, id: string): FightSessionState => ({
  ...fight,
  ...fight.environments[id],
  mode: 'remote',
  checkpoint: fight.cached[id] ?? null,
  mounted: false,
})

export const fight_render_state = (fight: FightSessionState, nearby_id?: string): FightSessionState =>
  nearby_id === undefined ? fight : nearby_fight_view(fight, nearby_id)

export const nearby_watch_changes = (current: NearbyFight, previous: NearbyFight, reconnect: boolean) => {
  if (current === previous && !reconnect) return []
  const binding = current ?? previous
  return binding
    ? [{ type: 'packet/fight_nearby' as const, character_id: binding.character_id, fight: current?.fight ?? null }]
    : []
}
