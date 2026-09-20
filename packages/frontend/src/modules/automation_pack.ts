// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { client_to_chain_coordinate } from '@aresrpg/immutable'

import { collect_all_available } from '../game/gather_gate.ts'
import { resource_at } from '../game/gather_target.ts'
import { resource_node_id } from '../game/resource_nodes.ts'
import { pose_matches_character } from '../game/core/pose_feed.ts'
import { SPAWN_INTERACTION_RANGE_BLOCKS } from '../game/core/world_input.ts'
import { journey_complete } from '../journey/model.ts'
import type { AppState } from '../store.ts'

import type { AutomationInput } from './automation_state.ts'
import { selected_character } from './session.ts'

export const collect_all_request = (
  state: AppState,
  input: Extract<AutomationInput, { type: 'automation/collect_all' }>
) => {
  const row = resource_at(input.node, state)
  if (!row || !collect_all_available(row.character, row.resource)) return null
  if (!pose_matches_character(input.pose, row.character.id)) return null
  const { pack, found } = row
  const distance = Math.hypot(
    pack.x - client_to_chain_coordinate(input.pose.x),
    pack.z - client_to_chain_coordinate(input.pose.z)
  )
  if (distance > SPAWN_INTERACTION_RANGE_BLOCKS) return null
  return {
    item_type: pack.item_type,
    scope: {
      type: 'pack' as const,
      target: { key: found.key, x: pack.x, z: pack.z, node: resource_node_id(row.node.pack_id, 0) },
      nodes: pack.nodes,
    },
  }
}

/** A finite pack never inherits journey automation's protector-forfeit policy. */
export const automation_access = (state: AppState): boolean => {
  const { run } = state.automation
  if (!run) return true
  if (run.scope.type === 'world') return journey_complete(state.journey)
  const character = selected_character(state.session)
  return ![
    state.session.link_status !== 'ready',
    character?.ambush,
    character?.active_fight,
    state.world.gathering[run.character_id]?.ambushed,
    state.fight.mounted,
    run.step.type === 'gathering' && run.step.fight,
  ].some(Boolean)
}
