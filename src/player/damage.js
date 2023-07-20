import { on } from 'events'
import { setInterval } from 'timers/promises'

import { aiter } from 'iterator-helper'
import combineAsyncIterators from 'combine-async-iterators'

import { PlayerEvent, WorldRequest } from '../events.js'
import { create_armor_stand } from '../armor_stand.js'
import logger from '../logger.js'
import { abortable } from '../iterator.js'
import Entities from '../../data/entities.json' assert { type: 'json' }
import { show_blood, show_death_smoke } from '../particules.js'
import { CATEGORY, play_sound } from '../sound.js'
import { PLAYER_ENTITY_ID } from '../settings.js'
import { compute_received_experience } from '../experience.js'
import Colors from '../colors.js'
import { can_receive_damage } from '../permissions.js'

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
  reduce(state, { type, payload }, client) {
    if (type === PlayerEvent.RECEIVE_DAMAGE && can_receive_damage(state)) {
      const { damage } = payload
      const health = Math.max(0, Math.round((state.health - damage) * 2) / 2)

      log.info({ username: client.username, damage, health }, 'took damage')

      return {
        ...state,
        health,
      }
    }
    return state
  },

  /** @type {import('../context.js').Observer} */
  observe({ events, dispatch, client, world, signal, get_state }) {
    aiter(
      abortable(on(events, PlayerEvent.RECEIVE_DAMAGE, { signal })),
    ).forEach(([{ damage }]) => {
      const { health } = get_state()
      client.write('entity_status', {
        entityId: PLAYER_ENTITY_ID,
        entityStatus: health - damage > 0 ? 2 : 3, // Hurt Animation and Hurt Sound (sound not working)
      })
      dispatch(PlayerEvent.RECEIVE_DAMAGE, { damage })
    })

    // @see more in src/SYNC.md
    aiter(
      abortable(
        on(world.events, WorldRequest.PLAYER_RECEIVE_DAMAGE, { signal }),
      ),
    )
      .map(([event]) => event)
      .forEach(({ damage, player: { uuid, entity_id, health, position } }) => {
        // if ourselves
        if (uuid === client.uuid)
          events.emit(PlayerEvent.RECEIVE_DAMAGE, { damage })
        // otherwise
        else {
          play_sound({
            client,
            sound: 'entity.player.hurt',
            category: CATEGORY.PLAYERS,
            ...position,
          })
          client.write('entity_status', {
            entityId: entity_id,
            entityStatus: health - damage > 0 ? 2 : 3, // Hurt Animation and Hurt Sound (sound not working)
            // TODO: fix sound
          })
        }
      })

    // The reason we need to pack all those events
    // is because we reduce data over time and they are cached in the reducer scope
    // this is a clever way to avoid overusing the player state
    aiter(
      abortable(
        // @ts-expect-error No overload matches this call
        combineAsyncIterators(
          on(events, PlayerEvent.MOB_DAMAGED, { signal }),
          on(events, PlayerEvent.MOB_DEATH, { signal }),
          on(world.events, WorldRequest.PLAYER_RECEIVE_DAMAGE, { signal }),
          setInterval(DAMAGE_INDICATOR_TTL / 2, [{ timer: true }], { signal }),
        ),
      ),
    )
      .map(([event]) => event)
      // the player object is only available for the PLAYER_RECEIVE_DAMAGE event
      // so this filter only takes effect for this particular event
      // and prevent doing computation if the player is its own target (sync logic)
      .filter(({ player }) => player?.uuid !== client.uuid)
      .reduce(
        (
          { cursor: last_cursor, ids },
          { mob, player, damage, timer, critical_hit },
        ) => {
          if (timer) {
            // entering here means the iteration is trigered by the interval
            // we only handle the removing of damage indicators
            const now = Date.now()
            ids
              .filter(({ age }) => age + DAMAGE_INDICATOR_TTL <= now)
              .forEach(({ entity_id }) =>
                client.write('entity_destroy', {
                  entityIds: [entity_id],
                }),
              )
            return {
              cursor: last_cursor,
              ids: ids.filter(({ age }) => age + DAMAGE_INDICATOR_TTL > now),
            }
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
          const is_dead = damage === undefined || player?.health - damage <= 0

          const color = damage > 0 ? Colors.RED : Colors.GREEN
          const critical_color =
            damage > 0 ? Colors.DARK_RED : Colors.DARK_GREEN

          if (!is_dead) {
            const sign = damage > 0 ? '-' : ''
            create_armor_stand(client, entity_id, position, {
              text: `${sign}${damage}`,
              color: critical_hit ? critical_color : color,
            })
            show_blood({ client, position: particle_position })
          } else {
            // if damaged entity is not a player
            if (mob) {
              const { xp } = Entities[mob.type]
              const received_experience = compute_received_experience(
                xp,
                get_state(),
              )
              if (received_experience) {
                events.emit(PlayerEvent.RECEIVE_EXPERIENCE, { experience: xp })
                create_armor_stand(client, entity_id, position, {
                  text: `+${xp} xp`,
                  color: '#3498DB',
                })
              }
            } else show_death_smoke({ client, position: particle_position })
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
        },
      )
  },
}
