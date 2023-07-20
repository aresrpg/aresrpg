import { to_inventory_array } from './equipments.js'
import { to_vanilla_item } from './items.js'
import { PLAYER_INVENTORY_ID } from './settings.js'

export const write_inventory = (client, { inventory, characteristics }) =>
  client.write('window_items', {
    windowId: PLAYER_INVENTORY_ID,
    items: to_inventory_array(inventory).map(item =>
      to_vanilla_item(item, { inventory, characteristics }),
    ),
  })
