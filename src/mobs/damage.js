import { on } from 'events'

import { aiter } from 'iterator-helper'
import combineAsyncIterators from 'combine-async-iterators'

import { MobEvent, PlayerEvent, WorldRequest } from '../events.js'
import logger from '../logger.js'
import { abortable } from '../iterator.js'
import Entities from '../../data/entities.json' assert { type: 'json' }
import { to_metadata } from '../entity_metadata.js'
import { compute_weapon_dealt_damage } from '../damage.js'
import {
  Characteristic,
  get_attack_delay,
  get_total_characteristic,
} from '../characteristics.js'

import { color_by_category } from './spawn.js'

const log = logger(import.meta)
const Mouse = {
  LEFT_CLICK: 1,
}

export default {
  /** @type {import('../mobs').MobsReducer} */
  reduce_mob(state, { type, payload }) {
    if (type === MobEvent.RECEIVE_DAMAGE) {
      const { damage, damager } = payload

      const health = Math.max(0, state.health - damage)

      log.info({ damage, health }, 'Deal Damage')

      return {
        first_damager: damager,
        ...state,
        last_damager: damager,
        health,
      }
    }
    return state
  },

  /** @type {import('../context.js').Observer} */
  observe({ client, get_state, world, events, signal, dispatch }) {
    aiter(
      abortable(
        combineAsyncIterators(
          on(client, 'use_entity', { signal }),
          on(events, PlayerEvent.PLAYER_INTERRACTED, { signal })
        )
      )
    )
      .map(([event]) => event)
      .dropWhile(({ mouse }) => mouse !== Mouse.LEFT_CLICK)
      .map(({ target, player }) => {
        const state = get_state()
        return {
          state,
          target,
          player,
        }
      })
      // if player is dead, he shouldn't interract
      .dropWhile(({ state: { health } }) => health <= 0)
      .reduce(
        (
          { frame_expiration, last_entities_ids },
          { target, player, state }
        ) => {
          const new_hit_frame = Date.now() > frame_expiration
          const entities_ids = new_hit_frame ? [] : last_entities_ids

          if (!entities_ids.includes(target)) {
            entities_ids.push(target)
            // hit
            const { damage, life_stolen, heal } =
              compute_weapon_dealt_damage(state)

            if (player) {
              // target is a player
              if (life_stolen) {
                // healing the player accordingly before damaging the other player
                const real_life_stolen = Math.min(player.health, life_stolen)
                dispatch(PlayerEvent.UPDATE_HEALTH, {
                  health: state.health + real_life_stolen,
                })
              }
              world.events.emit(WorldRequest.PLAYER_RECEIVE_DAMAGE, {
                player,
                damage: damage + life_stolen - heal,
                damager: client.uuid,
              })
            } else {
              const targeted_mob = world.mobs.by_entity_id(target)
              const { category } = Entities[targeted_mob?.type] ?? {}

              if (targeted_mob && category !== 'npc') {
                if (life_stolen) {
                  // healing the player accordingly before damaging the mob
                  const { health: mob_health } = targeted_mob.get_state()
                  const real_life_stolen = Math.min(mob_health, life_stolen)
                  dispatch(PlayerEvent.UPDATE_HEALTH, {
                    health: state.health + real_life_stolen,
                  })
                }
                targeted_mob.dispatch(MobEvent.RECEIVE_DAMAGE, {
                  // if more heal, then it will receive negative dmg (heal)
                  damage: damage + life_stolen - heal,
                  damager: client.uuid,
                })
              }
            }
          }

          const haste = get_total_characteristic(Characteristic.HASTE, state)
          return {
            last_entities_ids: entities_ids,
            frame_expiration: new_hit_frame
              ? Date.now() + get_attack_delay(haste)
              : frame_expiration,
          }
        },
        { frame_expiration: -1, last_entities_ids: [] }
      )

    events.on(PlayerEvent.MOB_ENTER_VIEW, ({ mob, signal }) => {
      aiter(abortable(on(mob.events, MobEvent.STATE_UPDATED, { signal })))
        .map(([{ health }]) => health)
        .reduce((last_health, health) => {
          if (last_health !== health) {
            const { entity_id, type, level } = mob
            const { category, display_name } = Entities[type]
            client.write('entity_status', {
              entityId: entity_id,
              entityStatus: health > 0 ? 2 : 3, // Hurt Animation and Hurt Sound (sound not working)
            })
            events.emit(PlayerEvent.MOB_DAMAGED, {
              mob,
              damage: last_health - health,
            })

            client.write('entity_metadata', {
              entityId: mob.entity_id,
              metadata: to_metadata('entity', {
                custom_name: JSON.stringify({
                  text: display_name,
                  color: color_by_category[category],
                  extra: level && [
                    { text: ` [Lvl ${level}] `, color: 'dark_red' },
                    { text: '(', color: 'white' },
                    { text: health, color: '#BA68C8' },
                    { text: ')', color: 'white' },
                  ],
                }),
              }),
            })

            if (health === 0) {
              events.emit(PlayerEvent.MOB_DEATH, { mob })
            }
          }
          return health
        })
    })
  },
}
