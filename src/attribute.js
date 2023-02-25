import {
  Characteristic,
  get_attack_delay,
  get_total_characteristic,
} from './characteristics.js'
import { PLAYER_ENTITY_ID } from './settings.js'

export function get_attack_speed({ inventory, characteristics }) {
  const haste = get_total_characteristic(Characteristic.HASTE, {
    inventory,
    characteristics,
  })
  const delay_in_seconds = get_attack_delay(haste) / 1000
  return 1 / delay_in_seconds
}

export function send_attributes(client, { attack_speed }) {
  client.write('entity_update_attributes', {
    entityId: PLAYER_ENTITY_ID,
    properties: [
      {
        key: 'generic.max_health',
        value: 40,
        modifiers: [],
      },
      {
        key: 'generic.attack_speed',
        value: attack_speed,
        modifiers: [],
      },
    ],
  })
}
