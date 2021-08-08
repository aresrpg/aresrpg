import { on } from 'events'

import { aiter } from 'iterator-helper'

import { create_armor_stand } from '../armor_stand.js'
import { abortable } from '../iterator.js'

export const DAMAGE_INDICATORS_AMMOUNT = 5

/** @param {import('../index.js').InitialWorld} world */
export function register(world) {
  return {
    ...world,
    damage_indicators: {
      amount: DAMAGE_INDICATORS_AMMOUNT,
      start_id: world.next_entity_id,
    },
    next_entity_id: world.next_entity_id + DAMAGE_INDICATORS_AMMOUNT,
  }
}

export default {
  /** @type {import('../index.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === 'create_damage_indicator') {
      const { position, damage } = payload
      const cursor =
        (state.damage_indicators.cursor + 1) % DAMAGE_INDICATORS_AMMOUNT
      const pool = [
        ...state.damage_indicators.pool.slice(0, cursor),
        { position, damage },
        ...state.damage_indicators.pool.slice(cursor + 1),
      ]

      return {
        ...state,
        damage_indicators: {
          cursor,
          pool,
        },
      }
    }
    return state
  },

  /** @type {import('../index.js').Observer} */
  observe({ events, dispatch, client, world, signal }) {
    events.on('mob_damage', ({ mob, damage }) => {
      const position = mob.position()
      const { height } = mob.constants

      const final_pos = {
        x: position.x + (Math.random() * 2 - 1) * 0.25,
        y: position.y + height - 0.25 + (Math.random() * 2 - 1) * 0.15,
        z: position.z + (Math.random() * 2 - 1) * 0.25,
      }
      dispatch('create_damage_indicator', { position: final_pos, damage })
    })

    aiter(abortable(on(events, 'state', { signal }))).reduce(
      (
        { cursor: last_cursor, handles },
        [
          {
            damage_indicators: { cursor, pool },
          },
        ]
      ) => {
        if (last_cursor !== cursor) {
          const { damage_indicators } = world
          const { position, damage } = pool[cursor]
          const entity_id = damage_indicators.start_id + cursor

          clearTimeout(handles[cursor])

          create_armor_stand(client, entity_id, position, {
            text: `-${damage}`,
            color: 'red',
          })

          const handle = setTimeout(() => {
            client.write('entity_destroy', {
              entityIds: [entity_id],
            })
          }, 1200)

          return {
            cursor,
            handles: [
              ...handles.slice(0, cursor),
              handle,
              ...handles.slice(cursor + 1),
            ],
          }
        }
        return { cursor, handles }
      },
      { cursor: -1, handles: Array.from({ length: DAMAGE_INDICATORS_AMMOUNT }) }
    )
  },
}
