import {
  Characteristic,
  get_attack_delay,
  get_total_characteristic,
} from './characteristics.js'
import { PLAYER_ENTITY_ID } from './settings.js'
import logger from './logger.js'

const log = logger(import.meta)
const VANILLA_MOVEMENT_SPEED = 0.1
const SPEED_INCREASE = 0.0036

export function get_attack_speed({ inventory, characteristics }) {
  const haste = get_total_characteristic(Characteristic.HASTE, {
    inventory,
    characteristics,
  })
  const delay_in_seconds = get_attack_delay(haste) / 1000
  return Math.round((1 / delay_in_seconds) * 100) / 100
}

export function get_movement_speed({ inventory, characteristics }) {
  const speed = get_total_characteristic(Characteristic.SPEED, {
    inventory,
    characteristics,
  })
  return VANILLA_MOVEMENT_SPEED + SPEED_INCREASE * speed
}

export function send_attack_speed(client, attack_speed) {
  log.info(
    { attack_speed, username: client.username },
    'send generic.attack_speed',
  )
  client.write('entity_update_attributes', {
    entityId: PLAYER_ENTITY_ID,
    properties: [
      {
        key: 'generic.attack_speed',
        value: attack_speed,
        modifiers: [],
      },
    ],
  })
}

export function send_movement_speed(client, speed) {
  log.info({ speed, username: client.username }, 'send generic.movement_speed')
  client.write('entity_update_attributes', {
    entityId: PLAYER_ENTITY_ID,
    properties: [
      {
        key: 'generic.movement_speed',
        value: speed,
        modifiers: [],
      },
    ],
  })
}
