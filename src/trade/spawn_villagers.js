import minecraftData from 'minecraft-data'
import UUID from 'uuid-1345'

import { chunk_position } from '../chunk.js'
import { version } from '../settings.js'

const mcData = minecraftData(version)
const chunk_index = (x, z) => `${x}:${z}`

export function register_traders(world) {
  const traders_in_chunk = world.traders.reduce((map, { x, z, y, name }, i) => {
    const chunk_x = chunk_position(x)
    const chunk_z = chunk_position(z)
    const index = chunk_index(chunk_x, chunk_z)
    const entry = map.get(index) || []
    return new Map([
      ...map.entries(),
      [index, [...entry, { x, z, y, name, id: world.next_entity_id + i }]],
    ])
  }, new Map())

  const recipes = world.traders.map(({ recipes, name }, i) => {
    return { id: world.next_entity_id + i, recipes, name }
  })

  return {
    ...world,
    next_entity_id: world.next_entity_id + world.traders.length,
    traders: {
      traders_in_chunk,
      recipes,
    },
  }
}

export function spawn_merchants({ client, events, world }) {
  const { traders_in_chunk } = world.traders
  const { id: type } = mcData.entitiesByName.villager
  events.on('chunk_loaded', ({ x: chunk_x, z: chunk_z }) => {
    if (traders_in_chunk.has(chunk_index(chunk_x, chunk_z))) {
      for (const { id, name, x, y, z } of traders_in_chunk.get(
        chunk_index(chunk_x, chunk_z)
      )) {
        const villager = {
          entityId: id,
          entityUUID: UUID.v4(),
          type,
          x,
          y,
          z,
          yaw: 0,
          pitch: 0,
          headPitch: 0,
          velocityX: 0,
          velocityY: 0,
          velocityZ: 0,
        }
        const metadata = {
          entityId: id,
          metadata: [
            {
              key: 2,
              value: JSON.stringify(`${name}`),
              type: 5,
            },
            {
              key: 3,
              type: 7,
              value: true,
            },
          ],
        }
        client.write('spawn_entity_living', villager)
        client.write('entity_metadata', metadata)
      }
    }
  })

  events.on('chunk_unloaded', ({ x, z }) => {
    if (traders_in_chunk.has(chunk_index(x, z))) {
      client.write('entity_destroy', {
        entityIds: traders_in_chunk.get(chunk_index(x, z)).map(({ id }) => id),
      })
    }
  })
}
