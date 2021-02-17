import { on } from 'events'

import minecraft_data from 'minecraft-data'
import UUID from 'uuid-1345'
import { aiter } from 'iterator-helper'

import { VERSION } from '../settings.js'

import { Types } from './types.js'

const { entitiesByName } = minecraft_data(VERSION)

const color_by_type = {
  mob: 'white',
  archiMob: 'gold',
  boss: 'red',
  npc: 'green',
  garde: 'blue',
}

function despawn_signal({ events, entity_id }) {
  const controller = new AbortController()

  aiter(on(events, 'mob_despawned'))
    .filter(([id]) => id === entity_id)
    .take(0) // TODO: should be 1, seems to be a iterator-helper bug
    .toArray()
    .then(() => controller.abort())

  return controller.signal
}

export function spawn_mob(client, { mob, position, events }) {
  const { entity_id, mob: mob_type, level } = mob
  const { type, mob: entity_type, displayName } = Types[mob_type]

  client.write('spawn_entity_living', {
    entityId: entity_id,
    entityUUID: UUID.v4(),
    type: entitiesByName[entity_type].id,
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
    metadata: [
      {
        key: 2,
        type: 5,
        value: JSON.stringify({
          text: displayName + `(${entity_id})`,
          color: color_by_type[type],
          extra: level && [{ text: ` [Lvl ${level}]`, color: 'dark_red' }],
        }),
      },
      {
        key: 3,
        type: 7,
        value: true,
      },
    ],
  })

  events.emit('mob_spawned', {
    mob,
    signal: despawn_signal({ events, entity_id: mob.entity_id }),
  })
}

export function despawn_mobs(client, { ids, events }) {
  client.write('entity_destroy', { entityIds: ids })
  for (const entity_id of ids) events.emit('mob_despawned', entity_id)
}

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, events }) {
    events.on('chunk_loaded_with_mobs', ({ mobs }) => {
      for (const { mob, position } of mobs)
        spawn_mob(client, { mob, position, events })
    })

    events.on('chunk_unloaded_with_mobs', ({ mobs }) => {
      despawn_mobs(client, {
        ids: mobs.map(({ mob }) => mob.entity_id),
        events,
      })
    })
  },
}
