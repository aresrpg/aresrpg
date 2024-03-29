import { on } from 'events'

import { aiter } from 'iterator-helper'

import { chunk_index, chunk_position, same_chunk } from '../core/chunk.js'
import { WorldRequest } from '../core/events.js'
import { abortable } from '../core/iterator.js'
import { synchronisation_payload } from '../core/sync.js'

const types = ['packet/position', 'packet/position_look', 'packet/look']

/** @type {import('../server').Module} */
export default {
  name: 'player_position',
  reduce(state, { type, payload }) {
    if (types.includes(type)) {
      return {
        ...state,
        position: {
          ...state.position,
          ...payload,
        },
      }
    }
    return state
  },

  observe({ world, client, signal, events, dispatch }) {
    aiter(abortable(on(events, 'STATE_UPDATED', { signal })))
      .map(([state]) => state)
      .reduce(
        ({ last_position, last_chunk_index }, state) => {
          const { position, health } = state
          const chunk_x = chunk_position(position.x)
          const chunk_z = chunk_position(position.z)
          const chunk = chunk_index(chunk_x, chunk_z)

          // only update position if alive (but still keep last_position up to date)
          if (health > 0 && position !== last_position) {
            const position_payload = {
              uuid: client.uuid,
              last_position,
              position,
            }
            if (chunk !== last_chunk_index) {
              // here we send a much bigger payload to inform newly met players
              // of every physical info like health, armor, etc
              world.events.emit(
                WorldRequest.CHUNK_POSITION_UPDATE(chunk),
                synchronisation_payload(client, state),
              )
            }
            // we still send the small update as the chunk_position_update doesn't contain the last_position
            // it is more comprehensive that way
            world.events.emit(
              WorldRequest.POSITION_UPDATE(chunk),
              position_payload,
            )

            if (!same_chunk(position, last_position)) {
              const last_chunk_x = chunk_position(last_position.x)
              const last_chunk_z = chunk_position(last_position.z)

              // here the player will be removed from other players so
              // we don't need to see the big info payload
              world.events.emit(
                WorldRequest.POSITION_UPDATE(
                  chunk_index(last_chunk_x, last_chunk_z),
                ),
                position_payload,
              )
            }
          }
          return { last_position: position, last_chunk_index: chunk }
        },
        {
          last_position: {},
          last_chunk_index: undefined,
        },
      )

    // when the module is loaded, teleport to the last known position
    events.once('STATE_UPDATED', state => {
      dispatch('TELEPORT_TO', state.position)
    })
  },
}
