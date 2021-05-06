import { on } from 'events'

import { aiter } from 'iterator-helper'

import logger from '../logger.js'

const log = logger(import.meta)
const Mouse = {
  LEFT_CLICK: 1,
}

export default {
  reduce_mob(state, { type, payload }) {
    if (type === 'deal_damage') {
      const { damage, damager } = payload
      const health = Math.max(0, state.health - damage)

      log.info({ damage, health }, 'Deal Damage')

      return {
        ...state,
        last_damager: damager,
        last_damage: damage,
        health,
      }
    }
    return state
  },

  /** @type {import('../index.js').Observer} */
  observe({ client, world, events }) {
    client.on('use_entity', ({ target, mouse }) => {
      if (mouse === Mouse.LEFT_CLICK) {
        const mob = world.mobs.by_entity_id(target)
        if (mob) {
          mob.dispatch('deal_damage', {
            damage: 1,
            damager: client.uuid,
          })
        }
      }
    })

    for (const mob of world.mobs.all) {
      aiter(on(mob.events, 'state')).reduce(
        (last_health, [{ health, last_damage }]) => {
          if (last_health !== health) {
            client.write('entity_status', {
              entityId: mob.entity_id,
              entityStatus: health > 0 ? 2 : 3, // Hurt Animation and Hurt Sound (sound not working)
            })
            events.emit('player_deal_damage', { mob, mob_damage: last_damage })
          }
          return health
        },
        null
      )
    }
  },
}
