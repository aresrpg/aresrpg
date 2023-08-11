import { EventEmitter, on } from 'events'

import { aiter } from 'iterator-helper'
import combineAsyncIterators from 'combine-async-iterators'

import {
  same_position,
  chunk_position,
  same_chunk,
  chunk_index,
} from '../core/chunk.js'
import { path_to_positions } from '../core/entity_path.js'

/** @param {import('../world').LivingWorld} world */
export default function register_mobs_position(world) {
  /** @type {import("../types.js").MobPositionsEvents} */
  const mobs_positions = new EventEmitter()

  aiter(
    combineAsyncIterators(
      on(mobs_positions, 'PROVIDE_POSITIONS'),
      on(mobs_positions, 'PROVIDE_MOBS'),
    ),
  )
    .map(([event]) => {
      if ('mob' in event) return event
      return { provide_mobs: event }
    })
    .reduce(
      (mobs_by_chunk, { mob, position, last_position, x, z, provide_mobs }) => {
        if (provide_mobs) {
          provide_mobs(mobs_by_chunk)
          return mobs_by_chunk
        }

        const mobs = mobs_by_chunk.get(chunk_index(x, z)) ?? []

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
        return mobs_by_chunk
      },
      new Map(),
    )

  for (const mob of world.mobs) {
    const state = aiter(on(mob.events, 'STATE_UPDATED')).map(([state]) => state)

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
        mobs_positions.emit('PROVIDE_POSITIONS', event)

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
    mobs_positions_emitter: mobs_positions,
  }
}
