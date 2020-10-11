import { version } from '../settings.js'
import minecraftData from 'minecraft-data'

const mcData = minecraftData(version)

export function open_trade(world) {
  const { villagers } = world
  const { id: diamond } = mcData.findItemOrBlockByName('diamond')
  const { id: diamond_sword } = mcData.findItemOrBlockByName('diamond_sword')

  const windowIds = new Map(
    villagers.map((entityId, i) => [entityId, world.lastWindowId + i])
  )

  function open_trade_handler({ client }) {
    client.on('use_entity', ({ target, mouse, sneaking }) => {
      if (villagers.includes(target) && mouse === 2 && sneaking === false) {
        const windowId = windowIds.get(target)
        const trade = {
          windowId,
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
          windowId,
          inventoryType: 18, //todo : add all inventories in a file
          windowTitle: JSON.stringify({ text: 'trade' }),
        }

        client.write('open_window', window)
        client.write('trade_list', trade)
      }
    })
  }
  return {
    handlers: [open_trade_handler],
    world: {
      ...world,
      lastWindowId: world.lastWindowId + windowIds.size,
    },
  }
}
