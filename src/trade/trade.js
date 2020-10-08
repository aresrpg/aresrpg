import { version } from '../settings.js'
import minecraftData from 'minecraft-data'

const mcData = minecraftData(version)

export function open_trade({ client }) {
  const { id: diamond } = mcData.findItemOrBlockByName('diamond')
  const { id: diamond_sword } = mcData.findItemOrBlockByName('diamond_sword')

  client.on('use_entity', ({ target, mouse, sneaking }) => {
    if (target === 69420 && mouse === 2 && sneaking === false) {
      const trade = {
        windowId: 1,
        trades: [
          {
            inputItem1: {
              present: true,
              itemId: diamond,
              itemCount: 1,
            },
            outputItem: {
              present: true,
              itemId: diamond_sword,
              itemCount: 1,
            },
            inputItem2: {
              present: true,
              itemId: diamond,
              itemCount: 1,
            },
            maximumNbTradeUses: 99999,
          },
        ],
      }

      const window = {
        windowId: 1,
        inventoryType: 18, //todo : add all inventories in a file
        windowTitle: JSON.stringify({ text: 'trade' }),
      }

      client.write('open_window', window)
      client.write('trade_list', trade)
    }
  })
}
