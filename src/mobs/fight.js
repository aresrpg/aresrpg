import { on } from 'events'

import { aiter } from 'iterator-helper'

import logger from '../logger.js'

const log = logger(import.meta)
const Mouse = {
  LEFT_CLICK: 1,
}

export function reduce_deal_damage(state, { type, payload }) {
  if (type === 'deal_damage') {
    const { damage, is_critical } = payload
    const health = Math.max(0, state.health - damage)

    log.info({ damage, health, is_critical }, 'Deal Damage')

    return {
      ...state,
      health,
    }
  }
  return state
}

export function deal_damage({ client, get_state, world }) {
  client.on('use_entity', ({ target, mouse, sneaking }) => {
    if (mouse === Mouse.LEFT_CLICK) {
      /* TODO:
        V : Basic Weapon Damages
        V : Critical damage
        X : Sync to inventory
        X : Add Statistics of Belt, Amulet and other
        V : Add WeaponStatistics+PlayerStatistics algorithm
      */

      const { inventory, stats } = get_state()
      let strength = stats[1].value
      let dexterity = stats[4].value

      // Get weaponDamage from the inHand Weapon.
      const slot_number = 2 + 36 // For the player 0 is the first item in hotbar. But for the game the hotbat begin at 36.
      const item = inventory[slot_number]
      let weaponDamage
      if (item) {
        const { type } = item
        const itemData = world.items[type]
        if (itemData.type === 'weapon') {
          const [minDamage, maxDamage] = itemData.damage
          weaponDamage = minDamage + Math.random() * (maxDamage - minDamage)
          if (itemData.critical) {
            dexterity += itemData.critical * 100 * 4
          }
        }
      }

      // Get the strength statistics of all equipped armor.
      for (const armor_slot of [5, 6, 7, 8]) {
        const item = inventory[armor_slot]
        if (inventory[armor_slot]) {
          const { type } = item
          const itemData = world.items[type]
          if (itemData.stats.strength) {
            strength += itemData.stats.strength
          }
          if (itemData.stats.strength) {
            strength += itemData.stats.strength
          }
        }
      }
      strength = Math.max(0, strength)

      let dmg = 1 + (weaponDamage + strength * 0.5)
      // Check if Critical Damage.
      const rand = Math.random() * 100
      const critc = Math.min(50, 1 + dexterity / 4)
      let is_critical = false
      if (rand < critc) {
        dmg *= 1.6
        is_critical = true
      }

      const mob = world.mobs.by_entity_id(target)
      if (mob) {
        mob.dispatch('deal_damage', {
          damage: Math.floor(dmg),
          is_critical,
        })
      }
    }
  })

  for (const mob of world.mobs.all) {
    aiter(on(mob.events, 'state')).reduce((last_health, [{ health }]) => {
      if (last_health !== health) {
        client.write('entity_status', {
          entityId: mob.entity_id,
          entityStatus: health > 0 ? 2 : 3, // Hurt Animation and Hurt Sound (sound not working)
        })
      }
      return health
    }, null)
  }
}
