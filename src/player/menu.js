import { destroy_menu, display_menu, Menus } from '../player_menu.js'
import freeze_player from '../freeze_player.js'
import { SCREENS } from '../settings.js'
import { PlayerEvent } from '../events.js'
import { is_inside } from '../math.js'

import { BlockDigStatus } from './inventory.js'

const armor_id = 4242
const clone_id = 4243

export default {
  /** @type {import('../context').Observer} */
  observe({ client, get_state, world, events }) {
    client.on('block_dig', ({ status }) => {
      if (
        status === BlockDigStatus.DROP_ITEM ||
        status === BlockDigStatus.DROP_ITEM_STACK
      ) {
        const { position, inventory } = get_state()

        freeze_player(client, armor_id, position)
        display_menu({
          client,
          world,
          position,
          type: Menus.equipment,
          inventory,
          clone_id,
        })

        events.on(PlayerEvent.SCREEN_INTERRACTED, payload => {
          const { intersect, screen_position, screen_id } = payload

          const interactables = {
            stats: {
              id: SCREENS.player_screen,
              min: {
                x: screen_position.x + 125,
                y: screen_position.y + 25,
              },
              max: {
                x: screen_position.x + 175,
                y: screen_position.y + 75,
              },
            },
          }

          console.log('stat:', interactables.stats)
          console.log('click:', intersect)

          if (
            is_inside(interactables.stats, intersect) &&
            interactables.stats.id === screen_id
          ) {
            display_menu({
              client,
              world,
              position,
              type: Menus.book,
            })
          }
        })
      }
    })

    const entityids = [armor_id, clone_id]
    const screenids = [SCREENS.player_screen, SCREENS.clone_background]
    client.on('steer_vehicle', ({ jump }) => {
      if (jump === 0x2) {
        destroy_menu(client, world, entityids, screenids)
      }
    })
  },
}
