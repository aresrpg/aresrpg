import { on } from 'events'

import { aiter } from 'iterator-helper'
import combineAsyncIterators from 'combine-async-iterators'

import { WorldRequest } from '../events.js'
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
import { can_interract_with_entities } from '../permissions.js'

import { color_by_category } from './spawn.js'
import { path_position } from './path.js'

const log = logger(import.meta)
const Mouse = {
  LEFT_CLICK: 1,
}
const KNOCKBACK_STRENGTH_BASE = 1
const KNOCKBACK_STRENGTH_REDUCTION = 0.0025

function get_knockback_position({
  damager_position,
  damaged_position,
  strength,
}) {
  const dX = damager_position.x - damaged_position.x
  const dZ = damager_position.z - damaged_position.z

  const length = Math.sqrt(dX * dX + dZ * dZ)
  const force_applied =
    Math.floor(
      (strength * KNOCKBACK_STRENGTH_REDUCTION + KNOCKBACK_STRENGTH_BASE) * 100,
    ) / 100

  return {
    x: damaged_position.x - (dX / length) * force_applied,
    y: damaged_position.y,
    z: damaged_position.z - (dZ / length) * force_applied,
  }
}

export default {
  /** @type {import('../mobs').MobsReducer} */
  async reduce_mob(state, { type, payload, time }) {
    if (type === 'RECEIVE_DAMAGE') {
      const {
        damage,
        damager,
        critical_hit,
        damager_position,
        damager_strength,
      } = payload

      const health = Math.max(0, state.health - damage)
      const knockback_target_block = get_knockback_position({
        damager_position,
        damaged_position: path_position({
          path: state.path,
          start_time: state.start_time,
          speed: state.speed,
          time,
        }),
        strength: damager_strength,
      })

      log.info({ damage, health }, 'Deal Damage')

      return {
        first_damager: damager,
        ...state,
        last_damager: damager,
        last_hit_was_critical: critical_hit,
        health,
        path: [knockback_target_block],
      }
    }
    return state
  },

  /** @type {import('../context.js').Observer} */
  observe({ client, get_state, world, events, signal, dispatch }) {
    aiter(
      abortable(
        combineAsyncIterators(
          on(events, 'PLAYER_INTERRACTED', { signal }),
          on(client, 'use_entity', { signal }),
        ),
      ),
    )
      .map(([event]) => event)
      .filter(({ mouse }) => mouse === Mouse.LEFT_CLICK)
      .map(({ target, player }) => ({
        state: get_state(),
        target,
        player,
      }))
      .filter(({ state }) => can_interract_with_entities(state))
      .reduce(
        (
          { frame_expiration, last_entities_ids },
          { target, player, state },
        ) => {
          // should we start a new frame
          const new_hit_frame = Date.now() > frame_expiration
          // we either keep going with the entities of the last frame, or we reset
          const entities_ids = new_hit_frame ? [] : last_entities_ids
          const { health, position } = state

          // for the frame, we allow to attack the same entity only once
          if (!entities_ids.includes(target)) {
            entities_ids.push(target)
            // hit
            const { damage, life_stolen, heal, critical_hit } =
              compute_weapon_dealt_damage(state)

            // target is a player
            if (player) {
              // healing the player accordingly before damaging the other player
              // TODO: note that we can't know if the player will reduce damage, we naively steal life here
              if (life_stolen) {
                const real_life_stolen = Math.min(player.health, life_stolen)
                dispatch('UPDATE_HEALTH', {
                  health: health + real_life_stolen,
                })
              }
              world.events.emit(WorldRequest.PLAYER_RECEIVE_DAMAGE, {
                player,
                damage: damage + life_stolen - heal,
                damager: client.uuid,
                critical_hit,
                entity_id: player.entity_id,
              })
            } else {
              const targeted_mob = world.mobs.by_entity_id(target)
              const { category } = Entities[targeted_mob?.type] ?? {}

              if (targeted_mob && category !== 'npc') {
                if (life_stolen) {
                  // healing the player accordingly before damaging the mob
                  const { health: mob_health } = targeted_mob.get_state()
                  const real_life_stolen = Math.min(mob_health, life_stolen)
                  dispatch('UPDATE_HEALTH', {
                    health: health + real_life_stolen,
                  })
                }

                targeted_mob.dispatch('RECEIVE_DAMAGE', {
                  // if more heal, then it will receive negative dmg (heal)
                  damage: damage + life_stolen - heal,
                  damager: client.uuid,
                  damager_position: position,
                  damager_strength: get_total_characteristic(
                    Characteristic.STRENGTH,
                    state,
                  ),
                  critical_hit,
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
        { frame_expiration: -1, last_entities_ids: [] },
      )

    events.on('MOB_ENTER_VIEW', ({ mob, signal }) => {
      aiter(abortable(on(mob.events, 'STATE_UPDATED', { signal })))
        .map(([{ health, last_hit_was_critical }]) => ({
          health,
          last_hit_was_critical,
        }))
        .reduce((last_health, { health, last_hit_was_critical }) => {
          if (last_health !== null && last_health !== health) {
            const { entity_id, type, level } = mob
            const { category, display_name } = Entities[type]
            client.write('entity_status', {
              entityId: entity_id,
              entityStatus: health > 0 ? 2 : 3, // Hurt Animation and Hurt Sound (sound not working)
              // TODO: fix sound
            })
            events.emit('MOB_DAMAGED', {
              mob,
              damage: last_health - health,
              critical_hit: last_hit_was_critical,
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
              events.emit('MOB_DEATH', {
                mob,
                critical_hit: last_hit_was_critical,
              })
            }
          }
          return health
        }, null)
    })
  },
}
