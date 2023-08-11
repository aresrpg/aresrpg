import UUID from 'uuid-1345'
import minecraftData from 'minecraft-data'

import { VERSION } from '../settings.js'

import { to_metadata } from './entity_metadata.js'

const mcData = minecraftData(VERSION)

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
  display_name,
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
    metadata: to_metadata('armor_stand', {
      entity_flags: { is_invisible: true },
      armor_stand_flags: { is_marker: true },
      custom_name: JSON.stringify(display_name),
      is_custom_name_visible: true,
    }),
  }

  client.write('spawn_entity_living', mob)
  client.write('entity_metadata', metadata)
}
