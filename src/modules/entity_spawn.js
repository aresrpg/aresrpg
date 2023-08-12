import { aiter } from 'iterator-helper'

import { chunk_index } from '../core/chunk.js'
import { destroy_entities, spawn_entity } from '../core/entity_spawn.js'
import { abortable, combine, named_on } from '../core/iterator.js'

/** @type {import('../server').Module} */
export default {
  name: 'entity_spawn',
  observe({ client, events, signal, world }) {
    aiter(
      abortable(
        combine(
          named_on(events, 'REQUEST_ENTITY_SPAWN', { signal }),
          named_on(events, 'REQUEST_ENTITIES_DESPAWN', { signal }),
        ),
      ),
    )
      .reduce((entities_in_view, { event, payload }) => {
        if (event === 'REQUEST_ENTITY_SPAWN') {
          const { mob, position } = payload

          if (mob.get_state().health <= 0) return entities_in_view

          spawn_entity(client, { mob, position })
          const entity_despawn_controller = new AbortController()

          events.emit('ENTITY_ENTER_VIEW', {
            mob,
            signal: entity_despawn_controller.signal,
          })

          return [
            ...entities_in_view,
            {
              id: mob.entity_id,
              controller: entity_despawn_controller,
            },
          ]
        }

        if (event === 'REQUEST_ENTITIES_DESPAWN') {
          const { ids } = payload
          destroy_entities(client, ids)
          return entities_in_view.filter(({ id }) => !ids.includes(id))
        }

        return entities_in_view
      }, [])
      .then(entities => {
        entities.forEach(({ controller }) => {
          controller.abort()
        })
        destroy_entities(
          client,
          entities.map(({ id }) => id),
        )
      })

    events.on('CHUNK_LOADED', ({ x, z }) => {
      world.mobs_positions_emitter.emit('PROVIDE_MOBS', mobs_by_chunk => {
        const mobs = mobs_by_chunk.get(chunk_index(x, z)) ?? []
        mobs.forEach(({ mob, position }) =>
          events.emit('REQUEST_ENTITY_SPAWN', {
            mob,
            position,
          }),
        )
      })
    })

    events.on('CHUNK_UNLOADED', ({ x, z }) => {
      world.mobs_positions_emitter.emit('PROVIDE_MOBS', mobs_by_chunk => {
        const mobs = mobs_by_chunk.get(chunk_index(x, z)) ?? []
        if (mobs.length)
          events.emit('REQUEST_ENTITIES_DESPAWN', {
            ids: mobs.map(({ entity_id }) => entity_id),
          })
      })
    })

    events.once('STATE_UPDATED', state => {
      // in case this module is loaded after the chunks are loaded
      // we spawn the entities in the already loaded chunks
      events.emit('PROVIDE_CHUNKS', chunks => {
        world.mobs_positions_emitter.emit('PROVIDE_MOBS', mobs_by_chunk => {
          chunks
            .flatMap(({ x, z }) => mobs_by_chunk.get(chunk_index(x, z)) ?? [])
            .forEach(({ mob, position }) =>
              events.emit('REQUEST_ENTITY_SPAWN', {
                mob,
                position,
              }),
            )
        })
      })
    })
  },
}
