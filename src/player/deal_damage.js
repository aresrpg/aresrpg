import { on } from 'events'

import { aiter } from 'iterator-helper'

import { create_armor_stand } from '../armor_stand.js'

export const DAMAGE_ARMOR_STAND_AMMOUNT = 5

export function register_damage_armor_stands() {
  return (world) => ({
    ...world,
    damage_armor_stands: {
      amount: DAMAGE_ARMOR_STAND_AMMOUNT,
      start_id: world.next_entity_id,
    },
    next_entity_id: world.next_entity_id + DAMAGE_ARMOR_STAND_AMMOUNT,
  })
}

export default {
  /** @type {import('../index.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === 'create_damage_armor_stand') {
      const { position, damage } = payload
      const cursor =
        state.damage_armor_stands.cursor >= DAMAGE_ARMOR_STAND_AMMOUNT - 1
          ? 0
          : state.damage_armor_stands.cursor + 1
      const pool = [...state.damage_armor_stands.pool]

      pool[cursor] = { position, damage }

      return {
        ...state,
        damage_armor_stands: {
          cursor,
          pool,
        },
      }
    }
    return state
  },

  /** @type {import('../index.js').Observer} */
  observe({ events, dispatch, client, world }) {
    events.on('player_deal_damage', ({ mob, damage }) => {
      const position = mob.position()
      const { height } = mob.constants

      const final_pos = {
        x: position.x + (Math.random() * 2 - 1) * 0.25,
        y: position.y + height - 0.25 + (Math.random() * 2 - 1) * 0.15,
        z: position.z + (Math.random() * 2 - 1) * 0.25,
      }
      dispatch('create_damage_armor_stand', { position: final_pos, damage })
    })

    aiter(on(events, 'state')).reduce(
      (
        last_cursor,
        [
          {
            damage_armor_stands: { cursor, pool },
          },
        ]
      ) => {
        if (last_cursor !== cursor) {
          const { damage_armor_stands } = world
          const { position, damage } = pool[cursor]
          const entity_id = damage_armor_stands.start_id + cursor

          create_armor_stand(client, entity_id, position, {
            text: `-${damage}`,
            color: 'red',
          })
          setTimeout(() => {
            client.write('entity_destroy', {
              entityIds: [entity_id],
            })
          }, 1200)
        }
        return cursor
      },
      -1
    )
  },
}
