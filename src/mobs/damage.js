import { on } from 'events'

import { aiter } from 'iterator-helper'

import { MobAction, MobEvent, PlayerEvent } from '../events.js'
import logger from '../logger.js'
import { abortable } from '../iterator.js'
import Entities from '../../data/entities.json' assert { type: 'json' }
import { to_metadata } from '../entity_metadata.js'
import { compute_weapon_dealt_damage } from '../damage.js'
import { get_attack_delay, get_haste } from '../characteristics.js'

import { color_by_category } from './spawn.js'

const log = logger(import.meta)
const Mouse = {
  LEFT_CLICK: 1,
}

export default {
  /** @type {import('../mobs').MobsReducer} */
  reduce_mob(state, { type, payload }) {
    if (type === MobAction.RECEIVE_DAMAGE) {
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
  observe({ client, get_state, world, events, signal }) {
    aiter(abortable(on(client, 'use_entity', { signal })))
      .map(([event]) => event)
      .dropWhile(({ mouse }) => mouse !== Mouse.LEFT_CLICK)
      .map(({ target }) => {
        const { health, inventory, characteristics } = get_state()
        const mob = world.mobs.by_entity_id(target)
        const { category } = Entities[mob?.type] ?? {}
        return {
          player_health: health,
          player_haste: get_haste({ inventory, characteristics }),
          mob,
          category,
        }
      })
      .dropWhile(
        ({ player_health, mob, category }) =>
          player_health <= 0 || !mob || category === 'npc'
      )
      .reduce(
        ({ frame_expiration, last_entities_ids }, { player_haste, mob }) => {
          const new_hit_frame = Date.now() > frame_expiration
          const entities_ids = new_hit_frame ? [] : last_entities_ids

          if (!entities_ids.includes(mob.entity_id)) {
            console.dir(
              { mob: mob.entity_id, delay: get_attack_delay(player_haste) },
              { depth: Infinity }
            )
            // hit
            const { damage } = compute_weapon_dealt_damage({})
            mob.dispatch(MobAction.RECEIVE_DAMAGE, {
              damage,
              damager: client.uuid,
            })
            entities_ids.push(mob.entity_id)
          }

          return {
            last_entities_ids: entities_ids,
            frame_expiration: new_hit_frame
              ? Date.now() + get_attack_delay(player_haste)
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
