import UUID from 'uuid-1345'
import { version } from '../settings.js'
import minecraftData from 'minecraft-data'

const mcData = minecraftData(version)

export function spawn_villager(world) {
  const entityId = world.lastEntityId

  function spawn_villager_handler({ client }) {
    const { id: type } = mcData.entitiesByName['villager']
    const mob = {
      entityId,
      entityUUID: UUID.v4(),
      type,
      x: 469,
      y: 163,
      z: 649,
      yaw: 0,
      pitch: 0,
      headPitch: 0,
      velocityX: 0,
      velocityY: 0,
      velocityZ: 0,
    }
    client.write('spawn_entity_living', mob)
  }

  return {
    handlers: [spawn_villager_handler],
    world: {
      ...world,
      lastEntityId: world.lastEntityId + 1,
      villagers: [entityId],
    },
  }
}
