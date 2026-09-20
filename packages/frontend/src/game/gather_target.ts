// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { content_catalog } from '../content/catalog.ts'
import { live_spawns, parse_resource_pack_id, resource_pack_id } from '../modules/world_spawns.ts'
import { selected_character } from '../modules/session.ts'
import type { AppState } from '../store.ts'

import { parse_resource_node_id, resource_seats } from './resource_nodes.ts'

export const resource_at = (id: string, state: AppState) => {
  const node = parse_resource_node_id(id)
  const character = selected_character(state.session)
  if (!node || !character?.world) return null
  const found = parse_resource_pack_id(node.pack_id)
  if (!found) return null
  const zone = state.world.zones[found.key]
  if (!zone || zone.world !== character.world || node.pack_id !== resource_pack_id(found.key, zone.seed, found.index))
    return null
  const pack = live_spawns(state.world, found.key).resources.find(({ index }) => index === found.index)
  if (!pack) return null
  const resource = content_catalog
    .world(character.world)
    ?.resources.find(({ item_type }) => item_type === pack.item_type)
  const seat = resource_seats(node.pack_id, pack.nodes)[node.ordinal]
  return resource && seat ? { node, found, pack, resource, seat, character } : null
}
