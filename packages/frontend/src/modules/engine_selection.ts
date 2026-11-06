// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Pure selected-character projections plus the one dungeon scene submission.

import { character_checkpoint, type PresenceRow } from '@aresrpg/protocol'
import { chain_to_client_coordinate } from '@aresrpg/immutable'

import { displayed_character, agent_watching } from '../agents/observation.ts'
import { content_catalog } from '../content/catalog.ts'
import type { create_world } from '../game/core/world.ts'
import {
  character_presence_row,
  owned_character_position,
  owned_character_presence_rows,
} from '../game/core/owned_character_feed.ts'
import {
  resolve_world_boot_position,
  type browser_position_storage,
  type ChainAnchor,
} from '../game/core/position_store.ts'
import type { AppState } from '../store.ts'

import { dungeon_portal_markers } from './world.ts'

export const selected_checkpoint_position = (state: AppState): Readonly<{ x: number; z: number }> | null => {
  const selected = displayed_character(state.session)
  const stage = selected_dungeon_position(state)
  if (stage) return stage
  if (!selected?.world || selected.world !== selected.checkpoint_world) return null
  return Number.isFinite(selected.x) && Number.isFinite(selected.z)
    ? {
        x: chain_to_client_coordinate(selected.x!),
        z: chain_to_client_coordinate(selected.z!),
      }
    : null
}

export const selected_live_position = (state: AppState): Readonly<{ x: number; z: number }> | null => {
  const selected = displayed_character(state.session)
  if (!selected?.world || selected.world !== selected.checkpoint_world) return null
  if (selected.dungeon_run) return null
  if (agent_watching(state.session)) {
    const remote = state.world.all_players[selected.id]
    return remote?.world === selected.world
      ? { x: chain_to_client_coordinate(remote.x), z: chain_to_client_coordinate(remote.z) }
      : null
  }
  const live = owned_character_position(selected.id, selected.world, character_checkpoint(selected))
  return live ? Object.freeze({ x: chain_to_client_coordinate(live.x), z: chain_to_client_coordinate(live.z) }) : null
}

export const selected_position = (state: AppState): Readonly<{ x: number; z: number }> | null =>
  selected_live_position(state) ?? selected_checkpoint_position(state)

/** Only an already-controlled same-world character can receive a continuous anchor correction. */
export const can_reconcile_target = (state: AppState, previous?: AppState): boolean =>
  previous !== undefined &&
  previous.session.selected_character_id === state.session.selected_character_id &&
  selected_world(previous) === selected_world(state) &&
  selected_position(previous) !== null

export const selected_anchor = (
  state: AppState
): Readonly<{ character_id: string; world: string; anchor: ChainAnchor }> | null => {
  const selected = displayed_character(state.session)
  if (!selected?.world || selected.world !== selected.checkpoint_world) return null
  if (!Number.isFinite(selected.x) || !Number.isFinite(selected.z)) return null
  return Object.freeze({
    character_id: selected.id,
    world: selected.world,
    anchor: Object.freeze({ x: selected.x!, z: selected.z!, at_ms: selected.at_ms ?? 0 }),
  })
}

export const selected_world = (state: AppState): string | null => displayed_character(state.session)?.world ?? null

export const selected_character_in_dungeon = (state: AppState): boolean =>
  displayed_character(state.session)?.dungeon_run !== undefined

export const world_presence_rows = (
  state: Readonly<AppState>,
  ground_height: (x: number, z: number) => number
): Readonly<Record<string, PresenceRow>> => {
  const followed = state.session.wallet
    ? owned_character_presence_rows(
        state.session.characters,
        state.session.wallet.address,
        selected_world(state),
        ground_height
      )
    : Object.freeze({})
  const observed = displayed_character(state.session)
  const { request } = state.session.agent_view
  const stage = selected_dungeon_position(state)
  const position = stage ? { x: stage.chain_x, z: stage.chain_z } : observed
  const fallback =
    request && observed?.world && position && Number.isFinite(position.x) && Number.isFinite(position.z)
      ? {
          [observed.id]: character_presence_row(observed, request.pairing.address, observed.world, {
            x: position.x!,
            y: ground_height(position.x!, position.z!),
            z: position.z!,
          }),
        }
      : {}
  if (stage) return Object.freeze(fallback)
  return Object.freeze({ ...followed, ...fallback, ...state.world.players })
}

export const selected_dungeon_position = (state: AppState) => {
  const selected = displayed_character(state.session)
  if (!selected?.dungeon_run) return null
  const city = content_catalog
    .world(selected.world ?? '')
    ?.cities.find(({ dungeon }) => dungeon === selected.dungeon_run!.dungeon)
  const chain_x = city?.x ?? 50_000
  const chain_z = city?.z ?? 50_000
  return { x: chain_to_client_coordinate(chain_x), z: chain_to_client_coordinate(chain_z), chain_x, chain_z }
}

export const sync_dungeon_scene = (world: ReturnType<typeof create_world> | null, state: AppState): void => {
  if (!world) return
  const selected = displayed_character(state.session)
  const run = selected?.dungeon_run
  world.set_dungeon_portals(run ? Object.freeze([]) : dungeon_portal_markers(selected_world(state)))
  if (!run) {
    world.set_crew_world(selected_world(state))
    world.set_dungeon_stage(null)
    return
  }
  world.set_crew_world(null)
  const { x, z } = selected_dungeon_position(state)!
  world.set_dungeon_stage(Object.freeze({ x, y: world.ground_height(x, z), z }))
}

export const resolve_selected_position = async (
  state: AppState,
  storage: ReturnType<typeof browser_position_storage>
): Promise<Readonly<{ x: number; z: number }> | null> => {
  const live = state.session.link_status === 'ready' ? selected_live_position(state) : null
  const checkpoint = live ?? selected_checkpoint_position(state)
  if (!checkpoint) return null
  if (agent_watching(state.session) || state.session.link_status !== 'ready') return checkpoint
  const identity = selected_anchor(state)
  if (!identity) return checkpoint
  try {
    return await resolve_world_boot_position({
      live,
      checkpoint,
      chain_anchor: identity.anchor,
      load: () => storage.load(identity.character_id, identity.world),
    })
  } catch (error) {
    console.error('The saved position could not be read — resuming at the checkpoint.', error)
    return checkpoint
  }
}
