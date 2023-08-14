import { chunk_index } from '../core/chunk.js'
import { destroy_entities, spawn_entity } from '../core/entity_spawn.js'

/** @type {import('../server').Module} */
export default {
  name: 'entity_spawn',
  observe({ client, events, signal, world, inside_view }) {
    // A Set being O(1) and an array O(n), what if we give up a bit of functionnal for simplicity ?
    // TODO: maybe we should try to give modules a more standalone outlook
    // TODO: and replace reducers by forEachs along with their own scoped variables
    // this would help clarify the code as there would be no more need to combine iterators
    const spawned_entities = new Set()
    const entities_controllers = new Map()

    events.on('REQUEST_ENTITY_SPAWN', mob => {
      if (mob.get_state().health > 0 && !spawned_entities.has(mob.entity_id)) {
        spawn_entity(client, mob)
        const entity_despawn_controller = new AbortController()

        spawned_entities.add(mob.entity_id)
        entities_controllers.set(mob.entity_id, entity_despawn_controller)

        events.emit('ENTITY_ENTER_VIEW', {
          mob,
          signal: entity_despawn_controller.signal,
        })
      }
    })

    events.on('REQUEST_ENTITIES_DESPAWN', ids => {
      destroy_entities(client, ids)
      ids.forEach(id => {
        spawned_entities.delete(id)
        entities_controllers.get(id).abort()
        entities_controllers.delete(id)
      })
    })

    signal.addEventListener(
      'abort',
      () => {
        entities_controllers.forEach(controller => controller.abort())
        destroy_entities(client, [...spawned_entities.values()])
      },
      { once: true },
    )

    world.mobs_positions_emitter.on(
      'MOB_POSITION',
      ({ mob, position, last_position, ...event }) => {
        const position_inside_view = inside_view(position)
        const last_position_inside_view = inside_view(last_position)

        if (position_inside_view && !last_position_inside_view) {
          // Mob entered view
          events.emit('REQUEST_ENTITY_SPAWN', mob)
        } else if (!position_inside_view && last_position_inside_view) {
          // Mob exited view
          events.emit('REQUEST_ENTITIES_DESPAWN', [mob.entity_id])
        } else if (spawned_entities.has(mob.entity_id)) {
          events.emit('ENTITY_MOVED_IN_VIEW', {
            mob,
            position,
            last_position,
            ...event,
          })
        }
      },
    )

    events.on('CHUNK_LOADED', ({ x, z }) => {
      world.mobs_positions_emitter.emit('PROVIDE_MOBS', mobs_by_chunk => {
        const mobs = mobs_by_chunk.get(chunk_index(x, z)) ?? []
        mobs.forEach(mob => {
          events.emit('REQUEST_ENTITY_SPAWN', mob)
        })
      })
    })

    events.on('CHUNK_UNLOADED', ({ x, z }) => {
      world.mobs_positions_emitter.emit('PROVIDE_MOBS', mobs_by_chunk => {
        const mobs = mobs_by_chunk.get(chunk_index(x, z)) ?? []
        if (mobs.length)
          events.emit(
            'REQUEST_ENTITIES_DESPAWN',
            mobs.map(({ entity_id }) => entity_id),
          )
      })
    })

    events.once('STATE_UPDATED', state => {
      // in case this module is loaded after the chunks are loaded
      // we spawn the entities in the already loaded chunks
      events.emit('PROVIDE_CHUNKS', chunks => {
        world.mobs_positions_emitter.emit('PROVIDE_MOBS', mobs_by_chunk => {
          chunks
            .flatMap(({ x, z }) => mobs_by_chunk.get(chunk_index(x, z)) ?? [])
            .forEach(mob => events.emit('REQUEST_ENTITY_SPAWN', mob))
        })
      })
    })
  },
}
