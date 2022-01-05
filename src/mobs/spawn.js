import { on } from 'events'

import minecraft_data from 'minecraft-data'
import UUID from 'uuid-1345'
import { aiter } from 'iterator-helper'

import { VERSION } from '../settings.js'
import { Context } from '../events.js'
import Entities from '../../data/entities.json'
import { to_metadata } from '../entity_metadata.js'


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

  aiter(on(events, Context.MOB_DESPAWNED))
    .filter(([id]) => id === entity_id)
    .take(0) // TODO: should be 1, seems to be a iterator-helper bug
    .toArray()
    .then(() => controller.abort())

  return controller.signal
}

export function spawn_mob(client, { mob, position, events }) {
  const { entity_id, mob: mob_type, level } = mob
  const { type, mob: entity_type, displayName } = Entities[mob_type]

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
    metadata: to_metadata('entity', {
      custom_name: JSON.stringify({
        text: displayName + `(${entity_id})`,
        color: color_by_type[type],
        extra: level && [{ text: ` [Lvl ${level}]`, color: 'dark_red' }],
      }),
      is_custom_name_visible: true,
    }),
  })

  events.emit(Context.MOB_SPAWNED, {
    mob,
    signal: despawn_signal({ events, entity_id: mob.entity_id }),
  })
}

export function despawn_mobs(client, { ids, events }) {
  client.write('entity_destroy', { entityIds: ids })
  for (const entity_id of ids) events.emit(Context.MOB_DESPAWNED, entity_id)
}

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, events }) {
    events.on(Context.CHUNK_LOADED_WITH_MOBS, ({ mobs }) => {
      for (const { mob, position } of mobs)
        spawn_mob(client, { mob, position, events })
    })

    events.on(Context.CHUNK_UNLOADED_WITH_MOBS, ({ mobs }) => {
      despawn_mobs(client, {
        ids: mobs.map(({ mob }) => mob.entity_id),
        events,
      })
    })
  },
}
