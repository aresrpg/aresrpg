import { PLAYER_INVENTORY_ID } from '../settings.js'

import { to_inventory_array } from './equipments.js'
import { to_vanilla_item } from './items.js'

export const write_inventory = (client, state) =>
  client.write('window_items', {
    windowId: PLAYER_INVENTORY_ID,
    items: to_inventory_array(state.inventory).map(item =>
      to_vanilla_item(item, state),
    ),
  })
