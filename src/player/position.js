import { on } from 'events'

import { aiter } from 'iterator-helper'

import { chunk_index, chunk_position, same_chunk } from '../chunk.js'
import { PlayerEvent, WorldRequest } from '../events.js'
import { abortable } from '../iterator.js'
import { synchronisation_payload } from '../sync.js'

const types = ['packet/position', 'packet/position_look', 'packet/look']

export default {
  /** @type {import('../context.js').Reducer} */
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

  /** @type {import('../context.js').Observer} */
  observe({ world, client, signal, events }) {
    aiter(abortable(on(events, PlayerEvent.STATE_UPDATED, { signal })))
      .map(([state]) => state)
      // only update position if alive
      .filter(({ health }) => health > 0)
      .reduce(
        ({ last_position, last_chunk_index }, state) => {
          const { position } = state
          const chunk_x = chunk_position(position.x)
          const chunk_z = chunk_position(position.z)
          const chunk = chunk_index(chunk_x, chunk_z)

          if (position !== last_position) {
            const position_payload = {
              uuid: client.uuid,
              last_position,
              position,
            }
            if (chunk !== last_chunk_index)
              // here we send a much bigger payload to inform newly met players
              // of every physical info like health, armor, etc
              world.events.emit(
                WorldRequest.CHUNK_POSITION_UPDATE(chunk),
                synchronisation_payload(client, state)
              )
            // we still send the small update as the chunk_position_update doesn't contain the last_position
            // it is more comprehensive that way
            world.events.emit(
              WorldRequest.POSITION_UPDATE(chunk),
              position_payload
            )

            if (!same_chunk(position, last_position)) {
              const last_chunk_x = chunk_position(last_position.x)
              const last_chunk_z = chunk_position(last_position.z)

              // here the player will be removed from other players so
              // we don't need to see the big info payload
              world.events.emit(
                WorldRequest.POSITION_UPDATE(
                  chunk_index(last_chunk_x, last_chunk_z)
                ),
                position_payload
              )
            }
          }
          return { last_position: position, last_chunk_index: chunk }
        },
        {
          last_position: {},
          last_chunk_index: undefined,
        }
      )
  },
}
