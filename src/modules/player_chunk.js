import { on } from 'events'

import { aiter, iter } from 'iterator-helper'

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
import { abortable, combine, named_on } from '../core/iterator.js'
import logger from '../logger.js'

const log = logger(import.meta)

/** @type {import('../server').Module} */
export default {
  name: 'player_chunk',
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
    function unload_and_abort({ x, z, controller }) {
      controller.abort()
      unload_chunk({ client, x, z })
      events.emit('CHUNK_UNLOADED', { x, z })
    }

    aiter(
      abortable(
        combine(
          named_on(events, 'REQUEST_CHUNKS_LOAD', { signal }),
          named_on(events, 'REQUEST_CHUNKS_UNLOAD', { signal }),
          named_on(events, 'PROVIDE_CHUNKS', { signal }),
        ),
      ),
    )
      .reduce(async (loaded_chunks, { event, payload }) => {
        if (event === 'PROVIDE_CHUNKS') {
          // removing the abort controller when providing chunks
          payload(loaded_chunks.map(({ x, z }) => ({ x, z })))
          return loaded_chunks
        }

        if (event === 'REQUEST_CHUNKS_UNLOAD') {
          const unloaded_chunks = loaded_chunks.filter(loaded_chunk =>
            payload.some(
              unloaded_chunk =>
                loaded_chunk.x === unloaded_chunk.x &&
                loaded_chunk.z === unloaded_chunk.z,
            ),
          )

          unloaded_chunks.forEach(unload_and_abort)

          return loaded_chunks.filter(loaded_chunk =>
            payload.every(
              unloaded_chunk =>
                loaded_chunk.x !== unloaded_chunk.x ||
                loaded_chunk.z !== unloaded_chunk.z,
            ),
          )
        }

        if (event === 'REQUEST_CHUNKS_LOAD') {
          const state = get_state()
          const points = payload.map(({ x, z }) => ({ x, y: z }))
          const sorted = sort_by_distance2d(
            {
              x: chunk_position(state.position.x),
              y: chunk_position(state.position.z),
            },
            points,
          )

          const newly_loaded_chunks = await iter(sorted)
            .toAsyncIterator()
            .map(async ({ x, y: z }) => {
              const chunk_unload_controller = new AbortController()

              await load_chunk({ client, world, x, z }) // TODO: handle errors somehow, kick client ?
              events.emit('CHUNK_LOADED', {
                x,
                z,
                signal: chunk_unload_controller.signal,
              })

              return {
                x,
                z,
                controller: chunk_unload_controller,
              }
            })
            .toArray()

          return [...loaded_chunks, ...newly_loaded_chunks]
        }
      }, [])
      // ! very important, when the module is unloaded we need to unload all the chunks
      .then(loaded_chunks => loaded_chunks.forEach(unload_and_abort))

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

    // load first chunk of the player
    events.once('STATE_UPDATED', ({ position }) => {
      const chunk = {
        x: chunk_position(position.x),
        z: chunk_position(position.z),
      }

      client.write('update_view_position', {
        chunkX: chunk.x,
        chunkZ: chunk.z,
      })

      events.emit('REQUEST_CHUNKS_LOAD', [chunk])
    })
  },
}
