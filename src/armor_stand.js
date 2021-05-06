import UUID from 'uuid-1345'
import minecraftData from 'minecraft-data'

import { version } from './settings.js'

const mcData = minecraftData(version)

/**
 * create an armor_stand to create
 * a text line with its display name
 * @param {any} client
 * @param {number} entity_id
 * @param {any} position
 * @param {any} display_name
 */
export function create_armor_stand(
  client,
  entity_id,
  { x, y, z },
  display_name
) {
  const mob = {
    entityId: entity_id,
    entityUUID: UUID.v4(),
    type: mcData.entitiesByName.armor_stand.id,
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
    entityId: entity_id,
    metadata: [
      // TODO: fix magic number
      { key: 0, type: 0, value: 0x20 },
      {
        key: 2,
        value: JSON.stringify(display_name),
        type: 5,
      },
      {
        key: 3,
        type: 7,
        value: true,
      },
      { key: 14, type: 0, value: 0x10 },
    ],
  }

  client.write('spawn_entity_living', mob)
  client.write('entity_metadata', metadata)
}
