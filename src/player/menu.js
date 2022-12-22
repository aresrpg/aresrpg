import { destroy_menu, display_menu, Menus } from '../player_menu.js'
import freeze_player from '../freeze_player.js'
import { SCREENS } from '../settings.js'
import { Context } from '../events.js'
import { is_inside } from '../math.js'
import { world_chat_msg } from '../chat.js'

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

        events.on(Context.SCREEN_INTERRACT, payload => {
          const { x, y, screen_id } = payload

          const click_position = {
            x,
            y,
          }

          const interactables = {
            stats: {
              min: { x: 500, y: 0 },
              max: { x: 1000, y: 1000 },
            },
            trade: {
              min: { x: 0, y: 500 },
              max: { x: 1000, y: 1000 },
            },
          }

          console.log('position:', click_position)
          console.log('screen:', screen_id)

          if (is_inside(interactables.stats, click_position)) {
            display_menu({
              client,
              world,
              position,
              type: Menus.book,
            })
          }

          if (is_inside(interactables.trade, click_position)) {
            client.write('block_change', {
              location: position,
              type: 3412,
            })
            client.write('open_sign_entity', {
              location: position,
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

    client.on('update_sign', ({ location, text1, text2, text3, text4 }) => {
      client.write('block_change', {
        location,
        type: 0,
      })
      world_chat_msg({
        world,
        message: `watich est sexy ? -> ${text1}`,
        client,
      })
    })
  },
}
