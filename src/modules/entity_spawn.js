import { on } from 'events'

import { aiter } from 'iterator-helper'

import { chunk_index } from '../core/chunk.js'
import { destroy_entities, spawn_entity } from '../core/entity_spawn.js'
import { abortable } from '../core/iterator.js'

/** @type {import('../server').Module} */
export default {
  observe({ client, events, signal, world, on_unload }) {
    events.on('REQUEST_ENTITY_SPAWN', ({ mob, position }) => {
      spawn_entity(client, { mob, position })
      const entity_despawn_controller = new AbortController()

      events.emit('ENTITY_ENTER_VIEW', {
        mob,
        signal: entity_despawn_controller.signal,
      })

      // allows to run only once when the entity is despawned
      aiter(abortable(on(events, 'REQUEST_ENTITIES_DESPAWN', { signal })))
        .map(([{ ids }]) => ids)
        .dropWhile(ids => !ids.includes(mob.entity_id))
        .take(1)
        .toArray()
        // this will be triggered either when the entity is despawned or when the module is unloaded
        .finally(() => {
          entity_despawn_controller.abort()
          destroy_entities(client, [mob.entity_id])
        })
    })

    events.on('CHUNK_LOADED', ({ x, z }) => {
      world.mobs_positions_emitter.emit('PROVIDE_MOBS', mobs_by_chunk => {
        const mobs = mobs_by_chunk.get(chunk_index(x, z)) ?? []
        for (const { mob, position } of mobs) {
          events.emit('REQUEST_ENTITY_SPAWN', {
            mob,
            position,
          })
        }
      })
    })

    events.on('CHUNK_UNLOADED', ({ x, z }) => {
      world.mobs_positions_emitter.emit('PROVIDE_MOBS', mobs_by_chunk => {
        const mobs = mobs_by_chunk.get(chunk_index(x, z)) ?? []
        if (mobs.length)
          events.emit('REQUEST_ENTITIES_DESPAWN', {
            ids: mobs.map(({ id }) => id),
          })
      })
    })
  },
}
