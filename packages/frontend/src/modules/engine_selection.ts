// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure selected-character projections plus the one dungeon scene submission.

import { chain_to_client_coordinate } from '@aresrpg/immutable'

import { content_catalog } from '../content/catalog.ts'
import type { create_world } from '../game/core/world.ts'
import { owned_character_position, owned_character_presence_rows } from '../game/core/owned_character_feed.ts'
import type { ChainAnchor } from '../game/core/position_store.ts'
import type { AppState } from '../store.ts'

import { dungeon_portal_markers } from './world.ts'

export const selected_checkpoint_position = (state: AppState): Readonly<{ x: number; z: number }> | null => {
  const selected = state.session.characters.find(({ id }) => id === state.session.selected_character_id)
  if (!selected?.world || selected.world !== selected.checkpoint_world) return null
  return Number.isFinite(selected.x) && Number.isFinite(selected.z)
    ? {
        x: chain_to_client_coordinate(selected.x!),
        z: chain_to_client_coordinate(selected.z!),
      }
    : null
}

export const selected_live_position = (state: AppState): Readonly<{ x: number; z: number }> | null => {
  const selected = state.session.characters.find(({ id }) => id === state.session.selected_character_id)
  if (!selected?.world || selected.world !== selected.checkpoint_world) return null
  const live = owned_character_position(selected.id, selected.world)
  return live ? Object.freeze({ x: chain_to_client_coordinate(live.x), z: chain_to_client_coordinate(live.z) }) : null
}

export const selected_position = (state: AppState): Readonly<{ x: number; z: number }> | null =>
  selected_live_position(state) ?? selected_checkpoint_position(state)

export const selected_anchor = (
  state: AppState
): Readonly<{ character_id: string; world: string; anchor: ChainAnchor }> | null => {
  const selected = state.session.characters.find(({ id }) => id === state.session.selected_character_id)
  if (!selected?.world || selected.world !== selected.checkpoint_world) return null
  if (!Number.isFinite(selected.x) || !Number.isFinite(selected.z)) return null
  return Object.freeze({
    character_id: selected.id,
    world: selected.world,
    anchor: Object.freeze({ x: selected.x!, z: selected.z!, at_ms: selected.at_ms ?? 0 }),
  })
}

export const selected_world = (state: AppState): string | null =>
  state.session.characters.find(({ id }) => id === state.session.selected_character_id)?.world ?? null

export const selected_character_in_dungeon = (state: AppState): boolean =>
  state.session.characters.some(
    ({ id, dungeon_run }) => id === state.session.selected_character_id && dungeon_run !== undefined
  )

export const world_presence_rows = (state: Readonly<AppState>, ground_height: (x: number, z: number) => number) => {
  const followed = state.session.wallet
    ? owned_character_presence_rows(
        state.session.characters,
        state.session.wallet.address,
        selected_world(state),
        ground_height
      )
    : Object.freeze({})
  return Object.freeze({ ...state.world.players, ...followed })
}

export const sync_dungeon_scene = (world: ReturnType<typeof create_world> | null, state: AppState): void => {
  if (!world) return
  const selected = state.session.characters.find(({ id }) => id === state.session.selected_character_id)
  const run = selected?.dungeon_run
  world.set_dungeon_portals(run ? Object.freeze([]) : dungeon_portal_markers(selected_world(state)))
  if (!run) {
    world.set_dungeon_stage(null)
    return
  }
  const city = content_catalog.world(selected.world ?? '')?.cities.find(({ dungeon }) => dungeon === run.dungeon)
  const x = chain_to_client_coordinate(city?.x ?? 50_000)
  const z = chain_to_client_coordinate(city?.z ?? 50_000)
  world.set_dungeon_stage(Object.freeze({ x, y: world.ground_height(x, z), z }))
}
