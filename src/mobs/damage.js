import { on } from 'events'

import { aiter } from 'iterator-helper'

import { MobAction, Context, Mob } from '../events.js'
import logger from '../logger.js'
import { abortable } from '../iterator.js'

import { Types } from './types.js'

const log = logger(import.meta)
const Mouse = {
  LEFT_CLICK: 1,
}

export default {
  reduce_mob(state, { type, payload }) {
    if (type === MobAction.DEAL_DAMAGE) {
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
  observe({ client, world, events }) {
    client.on('use_entity', ({ target, mouse }) => {
      if (mouse === Mouse.LEFT_CLICK) {
        const mob = world.mobs.by_entity_id(target)
        const { type } = Types[mob?.mob]
        if (mob && type !== 'npc') {
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
            client.write('entity_status', {
              entityId: mob.entity_id,
              entityStatus: health > 0 ? 2 : 3, // Hurt Animation and Hurt Sound (sound not working)
            })
            events.emit(Context.MOB_DAMAGE, {
              mob,
              damage: last_health - health,
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
