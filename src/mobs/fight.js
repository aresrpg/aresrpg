import { on } from 'events'

import { reduce, pipeline } from 'streaming-iterables'

import logger from '../logger.js'

const log = logger(import.meta)

export function reduce_deal_damage(state, { type, payload }) {
  if (type === 'deal_damage') {
    const { damage } = payload
    const life = Math.max(0, state.life - damage)

    log.info({ damage, life }, 'Deal Damage')

    return {
      ...state,
      life,
    }
  }
  return state
}

export function deal_damage({ client, world }) {
  client.on('use_entity', ({ target, mouse, sneaking }) => {
    const left_click = 1
    if (mouse === left_click) {
      const mob = world.mobs.by_entity_id(target)
      if (mob) {
        mob.dispatch('deal_damage', {
          damage: 1,
        })
      }
    }
  })

  for (const mob of world.mobs.all) {
    pipeline(
      () => on(mob.events, 'state'),
      reduce((last_life, [{ life }]) => {
        if (last_life !== life) {
          client.write('entity_status', {
            entityId: mob.entity_id,
            entityStatus: life > 0 ? 2 : 3, // Hurt Animation and Hurt Sound (sound not working)
          })
        }
        return life
      }, null)
    )
  }
}
