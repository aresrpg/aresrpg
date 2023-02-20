import { on } from 'events'
import { setInterval } from 'timers/promises'

import { aiter } from 'iterator-helper'
import combineAsyncIterators from 'combine-async-iterators'

import { PlayerEvent, WorldRequest } from '../events.js'
import { create_armor_stand } from '../armor_stand.js'
import logger from '../logger.js'
import { GameMode } from '../gamemode.js'
import { abortable } from '../iterator.js'
import Entities from '../../data/entities.json' assert { type: 'json' }
import { show_blood, show_death_smoke } from '../particules.js'

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
      type === PlayerEvent.RECEIVE_DAMAGE &&
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

  // TODO: Handle reception of worldrequest.DAMAGE_PLAYER for damage and heal

  /** @type {import('../context.js').Observer} */
  observe({ events, dispatch, client, world, signal }) {
    // here we handle the damage taken by our observed client
    // this come all the way from sync.js which listens for `use_entity` packet and match uuids
    aiter(
      abortable(
        on(world.events, WorldRequest.PLAYER_RECEIVE_DAMAGE, { signal })
      )
    )
      .map(([event]) => event)
      .dropWhile(({ uuid }) => uuid !== client.uuid)
      .forEach(({ damage }) => {
        dispatch(PlayerEvent.RECEIVE_DAMAGE, { damage })
      })

    aiter(
      abortable(
        // @ts-ignore
        combineAsyncIterators(
          on(events, PlayerEvent.MOB_DAMAGED, { signal }),
          on(events, PlayerEvent.MOB_DEATH, { signal }),
          on(world.events, WorldRequest.PLAYER_RECEIVE_DAMAGE, { signal }),
          setInterval(DAMAGE_INDICATOR_TTL / 2, [{ timer: true }], { signal })
        )
      )
    )
      .map(([event]) => event)
      .reduce(
        ({ cursor: last_cursor, ids }, { mob, player, damage, timer }) => {
          if (timer) {
            // entering here means the iteration is trigered by the interval
            // we only handle the removing of damage indicators
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
          const { x, y, z } = player?.position ?? mob.position()
          const { height } = player ? { height: 2 } : mob.constants
          const position = {
            x: x + (Math.random() * 2 - 1) * 0.25,
            y: y + height - 0.25 + (Math.random() * 2 - 1) * 0.15,
            z: z + (Math.random() * 2 - 1) * 0.25,
          }
          const particle_position = { x, y: y + height * 0.7, z }
          // the MOB_DEATH event doesn't emit a damage value
          // so we can safely assume that if damage is undefined
          // the mob is dead
          const is_dead = damage === undefined

          if (!is_dead) {
            const sign = damage <= 0 ? '' : '-'
            create_armor_stand(client, entity_id, position, {
              text: `${sign}${damage}`,
              color: damage <= 0 ? '#2ECC71' : '#E74C3C', // https://materialui.co/flatuicolors Emerland / Alizarin
            })
            show_blood({ client, position: particle_position })
          } else {
            const { xp } = Entities[mob.type]
            create_armor_stand(client, entity_id, damage_position, {
              text: `+${xp} xp`,
              color: '#3498DB',
            })
            show_death_smoke({ client, position: particle_position })
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
