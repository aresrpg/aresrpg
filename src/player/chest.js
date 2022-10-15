import { empty_slot, item_to_slot } from '../items.js'
import items from '../../data/items.json' assert { type: 'json' }
import { BANK_INVENTORY_ID } from '../settings.js'
import { get_block } from '../chunk.js'

const invId = BANK_INVENTORY_ID
const invType = 5 // 9x6 chest

const to_slot = item =>
  item ? item_to_slot(items[item.type], item.count) : empty_slot

async function open_bank({ client, get_state }) {
  const { bank } = get_state()

  client.write('open_window', {
    windowId: invId,
    inventoryType: invType,
    windowTitle: JSON.stringify({
      text: 'Banque',
    }),
  })

  client.write('window_items', {
    windowId: invId,
    items: bank.map(item =>
      item ? item_to_slot(items[item.type], item.count) : empty_slot
    ),
  })
}

function on_window_click({ client, get_state }) {
  return () => {
    const CURSOR = { windowId: invId, slot: -1 }
    const { inventory, bank, inventory_cursor } = get_state()

    client.write('window_items', {
      windowId: invId,
      items: [...bank, ...inventory.slice(8, 45)].map(item =>
        item ? item_to_slot(items[item.type], item.count) : empty_slot
      ),
    })

    console.log(inventory_cursor)

    client.write('set_slot', { ...CURSOR, item: to_slot(inventory_cursor) })
  }
}

export default {
  /** @type {import('../context.js').Observer} */
  observe(context) {
    const { client, world } = context
    client.on('block_place', async ({ location }) => {
      const { type } = await get_block(world, location)
      switch (type) {
        case 270: // Enderchest
          open_bank(context)
      }
    })

    client.on('window_click', on_window_click(context))
  },
}
