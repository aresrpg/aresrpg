import Items from '../../data/items.json' assert { type: 'json' }
import { Action, Context } from '../events.js'

const visible_mobs = {}

const HOTBAR_OFFSET = 36
const Hand = {
  MAINHAND: 0,
}

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, get_state, dispatch, events }) {

    events.on(Context.MOB_SPAWNED, ({mob}) => {
      visible_mobs[mob.entity_id] = mob
    })
    events.on(Context.MOB_DESPAWNED, ({entity_id}) => {
      delete visible_mobs[entity_id]
    })

    client.on('use_item', ({ hand }) => {
      if (hand === Hand.MAINHAND) {
        const { inventory, held_slot_index } = get_state()
        const slot_number = held_slot_index + HOTBAR_OFFSET
        const item = inventory[slot_number]
        const state = get_state()
        if (item && state.health > 0) {
          const { type } = item
          const itemData = Items[type]
          if (itemData.type === 'spellbook') {
            // spawn_sword_slash({client, position: {...position, y: position.y+1}, radius: 3, amount: 30})
            // spawn_firework({client, position: {...position, x: position.x+15, y: position.y+1}, max_radius: 20, amount: 10})
            // spawn_thunderbolts({client, position: {...position, x: position.x, y: position.y+20}, radius: 20})

            /* ---Totem Animation---
            const old_item = inventory[HOTBAR_OFFSET+held_slot_index+1]
            const temp_item = to_slot(old_item)
            temp_item.itemId = 904
            temp_item.nbtData.value.CustomModelData.value = 100
            delete temp_item.nbtData.value.Enchantments
            log.info(temp_item.nbtData, 'temp_item')
            client.write('set_slot', {
              windowId: 0,
              slot: HOTBAR_OFFSET+held_slot_index,
              item: temp_item,
            })
            client.write('entity_status', {
              entityId: client.entity_id,
              entityStatus: 35
            })
            client.write('set_slot', {
              windowId: 0,
              slot: HOTBAR_OFFSET+held_slot_index,
              item: to_slot(inventory[HOTBAR_OFFSET+held_slot_index]),
            }) */
            dispatch(Action.CAST_SPELL, {

            })
          }
        }
      }
    })
  }
}