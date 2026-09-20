// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { VISIBLE_SLOTS, visible_equipment, type ZoneRow, type ServerPacket } from '@aresrpg/protocol'

import type { Graph } from './graph.ts'
import type { Bus } from './pubsub_bus.ts'
import { channels } from './protocol.ts'
import { shared_projection } from './shared_projection.ts'
import { get_zones } from './reads/get_zones.ts'
import { mob_groups, resource_packs, world_population } from './zone_spawns.ts'

export const zone_identity = (world: string, zx: number, zz: number): string => `${world}:${zx}:${zz}`
const zone_coordinates = (key: string) => {
  const [world = '', zx = '0', zz = '0'] = key.split(':')
  return { world, zx: Number(zx), zz: Number(zz) }
}

type ZoneProjection = Readonly<{ zone: ZoneRow; spawns: Extract<ServerPacket, { type: 'packet/zone_spawns' }> | null }>

export const create_public_world = (graph: Graph, bus: Pick<Bus, 'emitter' | 'subscribe' | 'unsubscribe'>) => ({
  equipment: shared_projection({
    bus,
    channel: channels.character,
    invalidates: ({ type, data }) =>
      (type === 'ItemEquipped' || type === 'ItemUnequipped') &&
      (VISIBLE_SLOTS as readonly unknown[]).includes(data.slot),
    read: async (character) =>
      visible_equipment(
        (await graph.read(
          `MATCH (c:Character {id: $character})-[e:EQUIPS]->(i:Item)
       RETURN e.slot AS slot, i.item_type AS item_type`,
          { character }
        )) as { slot: string; item_type: string }[]
      ),
  }),
  zones: shared_projection<ZoneProjection | null>({
    bus,
    channel: (key) => {
      const { world, zx, zz } = zone_coordinates(key)
      return channels.zone(world, zx, zz)
    },
    invalidates: ({ type }) => ['ZoneSearched', 'ResourceGathered', 'FightCreated'].includes(type),
    read: async (key, previous) => {
      const { world, zx, zz } = zone_coordinates(key)
      const [zone] = await get_zones(graph, { world, zones: [{ zx, zz }] })
      if (!zone) return null
      if (previous?.zone.seed === zone.seed) return { zone, spawns: previous.spawns }
      const population = world_population(world)
      return {
        zone,
        spawns: population
          ? {
              type: 'packet/zone_spawns' as const,
              world,
              zx,
              zz,
              mobs: [...mob_groups(population, zx, zz, BigInt(zone.seed))],
              resources: [...resource_packs(population, zx, zz, BigInt(zone.seed))],
            }
          : null,
      }
    },
  }),
})
export type PublicWorld = ReturnType<typeof create_public_world>
