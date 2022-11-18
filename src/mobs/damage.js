import Entities from '../../data/entities.json' assert { type: 'json' }
import logger from '../logger.js'

import { on } from 'events'
import { aiter } from 'iterator-helper'
import { MobAction, Context, Mob } from '../events.js'
import { abortable } from '../iterator.js'
import { to_metadata } from '../entity_metadata.js'
import { color_by_category } from './spawn.js'

const log = logger(import.meta)
const invulnerability_time = 350
const Mouse = {
  LEFT_CLICK: 1,
}

export default {
  reduce_mob(state, { type, payload }) {
    if (type === MobAction.DEAL_DAMAGE) {
      const { damage, damager } = payload
      const { last_hit = -1 } = state
      const now = Date.now()

      if (last_hit + invulnerability_time < now) {
        const health = Math.max(0, state.health - damage)

        log.info({ damage, health }, 'Deal Damage')

        return {
          first_damager: damager,
          ...state,
          last_damager: damager,
          health,
          last_hit: now,
        }
      }
    }
    return state
  },

  /** @type {import('../context.js').Observer} */
  observe({ client, get_state, world, events, signal }) {
    client.on('use_entity', ({ target, mouse }) => {
      if (mouse === Mouse.LEFT_CLICK) {
        const mob = world.mobs.by_entity_id(target)
        const { category } = Entities[mob?.type] ?? {}
        const state = get_state()
        if (state.health > 0 && mob && category !== 'npc') {
          mob.dispatch(MobAction.DEAL_DAMAGE, {
            damage: 1,
            damager: client.uuid,
          })
        }
      }
    })

    events.on(Context.MOB_SPAWNED, ({ mob, signal }) => {
      aiter(abortable(on(mob.events, Mob.STATE, { signal })))
        .map(([{ health }]) => health)
        .reduce((last_health, health) => {
          if (last_health !== health) {
            const { entity_id, type, level } = mob
            const { category, displayName } = Entities[type]
            client.write('entity_status', {
              entityId: entity_id,
              entityStatus: health > 0 ? 2 : 3, // Hurt Animation and Hurt Sound (sound not working)
            })
            events.emit(Context.MOB_DAMAGE, {
              mob,
              damage: last_health - health,
            })

            client.write('entity_metadata', {
              entityId: mob.entity_id,
              metadata: to_metadata('entity', {
                custom_name: JSON.stringify({
                  text: displayName,
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
              events.emit(Context.MOB_DEATH, { mob })
            }
          }
          return health
        })
    })
  },
}
