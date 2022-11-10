/* import Items from '../../data/items.json' assert { type: 'json' }
import Entities from '../../data/entities.json' assert { type: 'json' }
import { Action, MobAction } from '../events.js'

import logger from '../logger.js'
const log = logger(import.meta)

const HOTBAR_OFFSET = 36
const Hand = {
  MAINHAND: 0,
}

export default { */
/** @type {import('../context.js').Observer} */
/* observe({ client, get_state, dispatch, world }) {
    client.on('use_item', ({ hand }) => {
      if (hand === Hand.MAINHAND) {
        const { inventory, held_slot_index, position } = get_state()
        const slot_number = held_slot_index + HOTBAR_OFFSET
        const item = inventory[slot_number]
        if (item) {
          const { type } = item
          const itemData = Items[type]
          log.info(itemData, "ItemData")
          if (itemData.type === 'spellbook') {
            for (const key in world.mob_positions) {
              const mob = world.mobs.all[key]
              const mob_pos = world.mob_positions[key]
              const { category } = Entities[mob.type]
              const state = get_state()
              if (state.health > 0 && mob && category !== 'npc') {
                const {x, y, z} = mob_pos.position
                if (x < position.x+16 && x > position.x-16) {
                  if (z < position.z+16 && z > position.z-16) {
                    if (y < position.y+5 && y > position.y-5) {
                      mob.dispatch(MobAction.DEAL_DAMAGE, {
                        damage: 1000,
                        damager: client.uuid,
                      })
                    }
                  }
                }
              }
            }
            dispatch(Action.CAST_SPELL, {

            })
          }
        }
      }
    })
  }
} */
