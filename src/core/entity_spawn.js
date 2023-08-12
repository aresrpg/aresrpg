import minecraft_data from 'minecraft-data'
import UUID from 'uuid-1345'

import Entities from '../../data/entities.json' assert { type: 'json' }
import { VERSION } from '../settings.js'

import { to_metadata } from './entity_metadata.js'

const { entitiesByName } = minecraft_data(VERSION)

export const color_by_category = {
  mob: 'white',
  archiMob: 'gold',
  boss: 'red',
  npc: 'green',
  garde: 'blue',
}

export function spawn_entity(client, { mob, position }) {
  const { entity_id, type, level } = mob
  const { category, minecraft_entity, display_name } = Entities[type]

  client.write('spawn_entity_living', {
    entityId: entity_id,
    entityUUID: UUID.v4(),
    type: entitiesByName[minecraft_entity].id,
    x: position.x,
    y: position.y,
    z: position.z,
    yaw: 0,
    pitch: 0,
    headPitch: 0,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
  })

  client.write('entity_metadata', {
    entityId: entity_id,
    metadata: to_metadata('entity', {
      custom_name: JSON.stringify({
        text: display_name + ' ' + entity_id,
        color: color_by_category[category],
        extra: level && [{ text: ` [Lvl ${level}]`, color: 'dark_red' }],
      }),
      is_custom_name_visible: true,
    }),
  })
}

export function destroy_entities(client, entityIds) {
  client.write('entity_destroy', { entityIds })
}
