import { PassThrough } from 'stream'
import EventEmitter, { on } from 'events'

import { aiter } from 'iterator-helper'

import {
  chunk_position,
  same_chunk,
  chunk_index,
  same_position,
} from '../chunk.js'
import { MobEvent, PlayerEvent } from '../events.js'

import { path_to_positions } from './path.js'

/** @param {import('../context.js').InitialWorldWithMobs} world */
export function register(world) {
  const mobs_positions = new EventEmitter()

  for (const mob of world.mobs.all) {
    const state = aiter(on(mob.events, MobEvent.STATE_UPDATED)).map(
      ([state]) => state,
    )

    const positions = path_to_positions(state)

    aiter(positions).reduce((last_position, { position, target }) => {
      if (!same_position(last_position, position)) {
        const chunk_x = chunk_position(position.x)
        const chunk_z = chunk_position(position.z)

        const event = {
          mob,
          position,
          last_position,
          target,
          x: chunk_x,
          z: chunk_z,
        }

        mobs_positions.emit(chunk_index(chunk_x, chunk_z), event)
        mobs_positions.emit('*', event)

        if (last_position != null && !same_chunk(position, last_position)) {
          const last_chunk_x = chunk_position(last_position.x)
          const last_chunk_z = chunk_position(last_position.z)

          mobs_positions.emit(chunk_index(last_chunk_x, last_chunk_z), event)
        }
      }
      return position
    }, null)
  }

  return {
    ...world,
    mobs: {
      ...world.mobs,
      positions: mobs_positions,
    },
  }
}

export default function mobs_position_factory({ mobs }) {
  const actions = new PassThrough({ objectMode: true })

  mobs.positions.on('*', payload =>
    actions.write({ type: 'mob_position', payload }),
  )

  /** @type {import('../context.js').Observer} */
  function observe({ events }) {
    events.on(PlayerEvent.CHUNK_LOADED, ({ x, z, signal }) => {
      actions.write({
        type: 'client_chunk_loaded',
        payload: { events, x, z, signal },
      })
    })

    events.on(PlayerEvent.CHUNK_UNLOADED, ({ x, z }) =>
      actions.write({
        type: 'client_chunk_unloaded',
        payload: { events, x, z },
      }),
    )
  }

  aiter(actions).reduce(
    (mobs_by_chunk, { type, payload: { x, z, ...payload } }) => {
      const mobs = mobs_by_chunk.get(chunk_index(x, z)) ?? []

      if (type === 'client_chunk_loaded')
        payload.events.emit(PlayerEvent.CHUNK_LOADED_WITH_MOBS, {
          mobs,
          x,
          z,
          signal: payload.signal,
        })
      else if (type === 'client_chunk_unloaded')
        payload.events.emit(PlayerEvent.CHUNK_UNLOADED_WITH_MOBS, {
          mobs,
          x,
          z,
        })
      else if (type === 'mob_position') {
        const { mob, last_position, position } = payload

        if (last_position == null)
          return new Map([
            ...mobs_by_chunk.entries(),
            [chunk_index(x, z), [...mobs, { mob, position }]],
          ])
        else if (!same_chunk(last_position, position)) {
          const last_x = chunk_position(last_position.x)
          const last_z = chunk_position(last_position.z)
          const last_mobs = mobs_by_chunk
            .get(chunk_index(last_x, last_z))
            .filter(({ mob: { entity_id } }) => entity_id !== mob.entity_id)

          return new Map([
            ...mobs_by_chunk.entries(),
            [chunk_index(last_x, last_z), last_mobs],
            [chunk_index(x, z), [...mobs, { mob, position }]],
          ])
        }
      } else throw new Error(`unknown type: ${type}`)

      return mobs_by_chunk
    },
    new Map(),
  )

  return {
    observe,
  }
}
