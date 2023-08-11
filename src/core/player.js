import { PLAYER_ENTITY_ID } from '../settings.js'

import { to_metadata } from './entity_metadata.js'

export function set_on_fire(client, on_fire = true) {
  client.write('entity_metadata', {
    entityId: PLAYER_ENTITY_ID,
    metadata: to_metadata('entity', {
      entity_flags: {
        is_on_fire: on_fire,
      },
    }),
  })
}

export function set_invisible(client, invisible = true) {
  client.write('entity_metadata', {
    entityId: PLAYER_ENTITY_ID,
    metadata: to_metadata('entity', {
      entity_flags: {
        is_invisible: invisible,
      },
    }),
  })
}
