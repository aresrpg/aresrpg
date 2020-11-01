import { item_to_slot, empty_slot } from '../items.js'

export function register_trades(world) {
  const windowIds = new Map(
    world.traders.recipes.map(({ id, recipes, name }, i) => [
      id,
      {
        windowId: world.lastWindowId + i,
        recipes,
        name,
      },
    ])
  )
  return {
    ...world,
    lastWindowId: world.lastWindowId + windowIds.size,
    traders: {
      ...world.traders,
      windowIds,
    },
  }
}

export function open_trade({ client, world }) {
  const { windowIds } = world.traders
  const right_click = 2
  const inventoryType = 18
  client.on('use_entity', ({ target, mouse, sneaking }) => {
    if (windowIds.has(target) && mouse === right_click && sneaking === false) {
      const { name, windowId, recipes: ares_recipe } = windowIds.get(target)
      const mc_recipe = ares_recipe.map((trade) => {
        const { inputItem1, inputItem2, outputItem } = trade
        const to_slot = (item) =>
          item ? item_to_slot(world.items[item.type], item.count) : empty_slot
        return {
          inputItem1: to_slot(inputItem1),
          inputItem2: to_slot(inputItem2),
          outputItem: to_slot(outputItem),
          maximumNbTradeUses: 99999,
        }
      })

      const trade = {
        windowId,
        trades: mc_recipe,
      }

      const window = {
        windowId,
        inventoryType,
        windowTitle: JSON.stringify({ text: name ?? 'default' }),
      }

      client.write('open_window', window)
      client.write('trade_list', trade)
    }
  })
}
