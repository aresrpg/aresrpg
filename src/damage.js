import {
  Characteristic,
  characteristic_from_element,
  get_fixed_damage,
  get_total_characteristic,
} from './characteristics.js'
import { is_yielding_weapon } from './items.js'
import { normalize_range } from './math.js'

const BARE_HAND_CRITICAL = 6

function random_base_damage({ from, to }) {
  return normalize_range(
    Math.random(),
    { min: 0, max: 1 },
    { min: from, max: to }
  )
}

export function compute_damage({
  base_damage,
  characteristic_amount,
  fixed_damage = 0,
}) {
  // Dégâts = (Base * (100 + Caractéristique + Puissance) / 100 + Dommages Fixes) * (1 - % résistance correspondant a l'élément de l'attaque)
  return Math.round(
    (base_damage * (100 + characteristic_amount)) / 100 + fixed_damage
  )
}

function is_critical(outcomes) {
  return Math.floor(Math.random() * outcomes) + 1 === 1
}

export function compute_weapon_dealt_damage({
  held_slot_index,
  inventory,
  characteristics,
}) {
  const fixed_damage = get_fixed_damage({ inventory })

  if (is_yielding_weapon({ held_slot_index, inventory })) {
    const {
      weapon: { critical, damage: all_damages },
    } = inventory
    const critical_hit = is_critical(critical.outcomes)

    return all_damages
      .map(({ from, to, type, element }) => ({
        computed_damage: compute_damage({
          base_damage: random_base_damage({ from, to }),
          characteristic_amount: get_total_characteristic(
            characteristic_from_element(element),
            { inventory, characteristics }
          ),
          fixed_damage,
        }),
        type,
      }))
      .reduce(
        (result, { computed_damage, type }) => {
          switch (type) {
            case 'damage':
              return {
                ...result,
                damage: result.damage + computed_damage,
              }
            case 'life_steal':
              return {
                ...result,
                life_steal: result.life_stolen + computed_damage,
              }
            case 'heal':
              return {
                ...result,
                heal: result.heal + computed_damage,
              }
            default:
              return result
          }
        },
        { damage: 0, life_stolen: 0, heal: 0, critical_hit }
      )
  }

  const critical_hit = is_critical(100) // 1/100 chances of critical when not using weapon

  return {
    damage: compute_damage({
      base_damage: critical_hit ? BARE_HAND_CRITICAL : 1,
      characteristic_amount: get_total_characteristic(Characteristic.STRENGTH, {
        inventory,
        characteristics,
      }),
      fixed_damage,
    }),
    life_stolen: 0,
    heal: 0,
    critical_hit,
  }
}
