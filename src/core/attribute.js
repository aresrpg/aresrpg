import { PLAYER_ENTITY_ID } from '../settings.js'
import logger from '../logger.js'

import {
  Characteristic,
  get_attack_delay,
  get_total_characteristic,
} from './characteristics.js'

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

export function get_movement_speed({ inventory, characteristics, soul }) {
  // a ghost must move slowly
  if (soul === 0) return 0.02

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

function abilities_flags({
  invulnerable = false,
  flying = false,
  allow_flying = false,
  creative_mode = false,
}) {
  return (
    (invulnerable ? 0x01 : 0) |
    (flying ? 0x02 : 0) |
    (allow_flying ? 0x04 : 0) |
    (creative_mode ? 0x08 : 0)
  )
}

export function set_flying(client, flying) {
  log.info({ flying, username: client.username }, 'send flying')
  client.write('abilities', {
    flags: abilities_flags({ flying }),
    flyingSpeed: 0.05,
    walkingSpeed: 0.1,
  })
}
