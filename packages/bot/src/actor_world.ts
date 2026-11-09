// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { ServerPacket, ZoneRow } from '@aresrpg/protocol'
import {
  zone_key,
  tracked_zone_keys,
  retain_zone_keys,
  merge_zone_rows,
  merge_zone_population,
} from '@aresrpg/protocol/world-projection'
export { zone_key } from '@aresrpg/protocol/world-projection'

export type ZoneSnapshot = Readonly<{
  zone: ZoneRow
  spawns: Extract<ServerPacket, { type: 'packet/zone_spawns' }> | null
}>
export type ActorWorld = Readonly<{
  zones: Readonly<Record<string, ZoneSnapshot>>
  tracked_zones: Readonly<Record<string, Extract<ServerPacket, { type: 'packet/tracked_zones' }>>>
}>
const prune_world = (state: ActorWorld): ActorWorld => ({
  ...state,
  zones: retain_zone_keys(state.zones, tracked_zone_keys(Object.values(state.tracked_zones))),
})
/** The ordinary server sends zone state immediately before population on a seed change.
 * Never retain population across that change, or accept it before the zone baseline. */
export const fold_actor_world = (state: ActorWorld, packet: ServerPacket): ActorWorld => {
  switch (packet.type) {
    case 'packet/tracked_zones':
      return prune_world({ ...state, tracked_zones: { ...state.tracked_zones, [packet.character_id]: packet } })
    case 'packet/characters': {
      const owned = new Set(packet.characters.map((character) => character.id))
      return prune_world({
        ...state,
        tracked_zones: Object.fromEntries(Object.entries(state.tracked_zones).filter(([id]) => owned.has(id))),
      })
    }
    case 'packet/zones': {
      const rows = Object.entries(state.zones)
      const projection = merge_zone_rows(
        Object.fromEntries(rows.map(([key, row]) => [key, row.zone])),
        Object.fromEntries(rows.flatMap(([key, row]) => (row.spawns ? [[key, row.spawns]] : []))),
        packet.zones
      )
      return {
        ...state,
        zones: Object.fromEntries(
          Object.entries(projection.zones).map(([key, zone]) => [key, { zone, spawns: projection.spawns[key] ?? null }])
        ),
      }
    }
    case 'packet/zone_spawns': {
      const key = zone_key(packet.world, packet.zx, packet.zz)
      const zones = Object.fromEntries(Object.entries(state.zones).map(([id, row]) => [id, row.zone]))
      const spawns = merge_zone_population(zones, {}, key, packet)
      return spawns[key]
        ? { ...state, zones: { ...state.zones, [key]: { zone: zones[key]!, spawns: spawns[key]! } } }
        : state
    }
    default:
      return state
  }
}
