import { on } from 'events'

import { aiter } from 'iterator-helper'

import {
  chunk_position,
  load_chunk,
  same_chunk,
  unload_chunk,
} from '../core/chunk.js'
import { position_equal } from '../core/position.js'
import {
  sort_by_distance2d,
  square_difference,
  square_symmetric_difference,
} from '../core/math.js'
import { PLAYER_ENTITY_ID } from '../settings.js'
import { abortable } from '../core/iterator.js'
import logger from '../logger.js'

const log = logger(import.meta)

/** @type {import('../server').Module} */
export default {
  reduce(state, { type, payload }) {
    if (type === 'packet/settings') {
      log.info({ view_distance: payload.viewDistance }, 'update view distance')
      const { viewDistance } = payload
      return {
        ...state,
        view_distance: Math.max(1, Math.min(viewDistance + 1, 12)),
      }
    }
    if (type === 'TELEPORT_TO') {
      return {
        ...state,
        teleport: payload,
      }
    }
    if (position_equal(state.position, state.teleport)) {
      return {
        ...state,
        teleport: null,
      }
    }
    return state
  },
  observe({ client, events, world, signal, dispatch, get_state }) {
    events.on('REQUEST_CHUNKS_LOAD', async chunks => {
      const state = get_state()
      const points = chunks.map(({ x, z }) => ({ x, y: z }))
      const sorted = sort_by_distance2d(
        {
          x: chunk_position(state.position.x),
          y: chunk_position(state.position.z),
        },
        points,
      )

      for (const { x, y: z } of sorted) {
        const chunk_unload_controller = new AbortController()

        // allows to run only once when the chunk is unloaded
        aiter(abortable(on(events, 'REQUEST_CHUNKS_UNLOAD', { signal })))
          .map(([chunks]) => chunks)
          .dropWhile(
            chunks => !chunks.some(chunk => chunk.x === x && chunk.z === z),
          )
          .take(1)
          .toArray()
          .finally(() => {
            chunk_unload_controller.abort()
            unload_chunk({ client, x, z })
            events.emit('CHUNK_UNLOADED', chunk)
          })

        await load_chunk({ client, world, x, z }) // TODO: handle errors somehow, kick client ?

        events.emit('CHUNK_LOADED', {
          x,
          z,
          signal: chunk_unload_controller.signal,
        })
      }
    })

    aiter(abortable(on(events, 'STATE_UPDATED', { signal })))
      .map(([{ position, view_distance, teleport }]) => ({
        position,
        view_distance,
        teleport,
      }))
      .reduce(
        async (last_state, state) => {
          // this check has to be the first has it will initialize a player without chunks
          // when the module is loaded its mandatory to send chunks in correct order
          // previously it worked without it because we were loading modules
          // before receiving the packet/settings from the client
          // but now with the ability to disable modules, we may not receive the packet/settings
          if (last_state.view_distance !== state.view_distance) {
            const chunk_point = {
              x: chunk_position(state.position.x),
              y: chunk_position(state.position.z),
            }
            const points = square_difference(
              chunk_point,
              last_state.view_distance,
              state.view_distance,
            )
            const chunks = points.map(({ x, y }) => ({ x, z: y }))

            client.write('update_view_distance', {
              viewDistance: state.view_distance,
            })

            if (state.view_distance > last_state.view_distance)
              events.emit('REQUEST_CHUNKS_LOAD', chunks)
            else events.emit('REQUEST_CHUNKS_UNLOAD', chunks)

            // as we now initialize the reduce with a default state instead of taking the first reduced element
            // we need to return the state here
            return state
          }

          if (
            state.teleport !== null &&
            !position_equal(last_state.teleport, state.teleport)
          ) {
            const chunk = {
              x: chunk_position(state.teleport.x),
              z: chunk_position(state.teleport.z),
            }

            client.write('update_view_position', {
              chunkX: chunk.x,
              chunkZ: chunk.z,
            })

            events.emit('REQUEST_CHUNKS_LOAD', [chunk])

            client.write('position', {
              entityId: PLAYER_ENTITY_ID,
              yaw: 0,
              pitch: 0,
              teleportId: 0,
              ...state.teleport,
              onGround: true,
            })
          }

          if (!same_chunk(last_state.position, state.position)) {
            const { a: points_to_unload, b: points_to_load } =
              square_symmetric_difference(
                {
                  x: chunk_position(last_state.position.x),
                  y: chunk_position(last_state.position.z),
                },
                {
                  x: chunk_position(state.position.x),
                  y: chunk_position(state.position.z),
                },
                state.view_distance,
              )

            client.write('update_view_position', {
              chunkX: chunk_position(state.position.x),
              chunkZ: chunk_position(state.position.z),
            })

            const to_unload = points_to_unload.map(({ x, y }) => ({ x, z: y }))
            events.emit('REQUEST_CHUNKS_UNLOAD', to_unload)

            const to_load = points_to_load.map(({ x, y }) => ({ x, z: y }))
            events.emit('REQUEST_CHUNKS_LOAD', to_load)
          }

          return state
        },
        {
          position: { x: 0, y: 0, z: 0 },
          view_distance: 0,
          teleport: null,
        },
      )
      .finally(() => {
        const state = get_state()
        if (state) {
          const chunk_point = {
            x: chunk_position(state.position.x),
            z: chunk_position(state.position.z),
          }

          for (let x = -state.view_distance; x <= state.view_distance; x++) {
            for (let z = -state.view_distance; z <= state.view_distance; z++) {
              events.emit('CHUNK_UNLOADED', {
                x: chunk_point.x + x,
                z: chunk_point.z + z,
              })
            }
          }
        }
      })

    // load first chunk on player position ================
    const { position } = get_state()

    const chunk = {
      x: chunk_position(position.x),
      z: chunk_position(position.z),
    }

    client.write('update_view_position', {
      chunkX: chunk.x,
      chunkZ: chunk.z,
    })

    events.emit('REQUEST_CHUNKS_LOAD', [chunk])
    // ====================================================
  },
}
