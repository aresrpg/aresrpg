import { on } from 'events'
import { setInterval } from 'timers/promises'

import { aiter } from 'iterator-helper'
import combineAsyncIterators from 'combine-async-iterators'

import { PlayerAction, PlayerEvent } from '../events.js'
import { create_armor_stand } from '../armor_stand.js'
import logger from '../logger.js'
import { GameMode } from '../gamemode.js'
import { abortable } from '../iterator.js'
import { Entities } from '../data.js'

const DAMAGE_INDICATORS_AMOUNT = 10
const DAMAGE_INDICATOR_TTL = 1200

const log = logger(import.meta)

/** @param {import('../context.js').InitialWorld} world */
export function register({ next_entity_id, ...world }) {
  return {
    ...world,
    damage_indicator_start_id: next_entity_id,
    next_entity_id: next_entity_id + DAMAGE_INDICATORS_AMOUNT,
  }
}

export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    if (
      type === PlayerAction.RECEIVE_DAMAGE &&
      state.game_mode !== GameMode.CREATIVE
    ) {
      const { damage } = payload
      const health = Math.max(0, state.health - damage)

      log.info({ damage, health }, 'took damage')

      return {
        ...state,
        health,
      }
    }
    return state
  },

  /** @type {import('../context.js').Observer} */
  observe({ events, dispatch, client, world, signal }) {
    aiter(
      abortable(
        // @ts-ignore
        combineAsyncIterators(
          on(events, PlayerEvent.MOB_DAMAGED, { signal }),
          on(events, PlayerEvent.MOB_DEATH, { signal }),
          setInterval(DAMAGE_INDICATOR_TTL / 2, [{ timer: true }], { signal })
        )
      )
    )
      .map(([{ mob, damage, timer }]) => ({ mob, damage, timer }))
      .reduce(
        ({ cursor: last_cursor, ids }, { mob, damage, timer }) => {
          if (timer) {
            // entering here means the iteration is trigered by the interval
            const now = Date.now()
            ids
              .filter(({ age }) => age + DAMAGE_INDICATOR_TTL < now)
              .forEach(({ entity_id }) =>
                client.write('entity_destroy', {
                  entityIds: [entity_id],
                })
              )
            return { cursor: last_cursor, ids }
          }

          const { damage_indicator_start_id } = world
          const cursor = (last_cursor + 1) % DAMAGE_INDICATORS_AMOUNT
          const entity_id = damage_indicator_start_id + cursor
          const { x, y, z } = mob.position()
          const { height } = mob.constants
          const position = {
            x: x + (Math.random() * 2 - 1) * 0.25,
            y: y + height - 0.25 + (Math.random() * 2 - 1) * 0.15,
            z: z + (Math.random() * 2 - 1) * 0.25,
          }

          if (damage !== undefined) {
            create_armor_stand(client, entity_id, position, {
              text: `-${damage}`,
              color: '#E74C3C', // https://materialui.co/flatuicolors Alizarin
            })
          } else {
            // Death
            const { xp } = Entities[mob.type]
            create_armor_stand(client, entity_id, position, {
              text: `+${xp} xp`,
              color: '#A6CD57',
            })
          }
          return {
            cursor,
            ids: [
              ...ids.slice(0, cursor),
              { entity_id, age: Date.now() },
              ...ids.slice(cursor + 1),
            ],
          }
        },
        {
          cursor: -1,
          ids: Array.from({ length: DAMAGE_INDICATORS_AMOUNT }).fill({
            age: Infinity,
          }),
        }
      )
  },
}
