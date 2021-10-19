import minecraft_data from 'minecraft-data'
import UUID from 'uuid-1345'

import { chunk_position, chunk_index } from '../chunk.js'
import { VERSION } from '../settings.js'
import { empty_slot, item_to_slot } from '../items.js'
import { Context } from '../events.js'

const mcData = minecraft_data(VERSION)

/** @param {import('../context.js').InitialWorld} world */
export function register(world) {
  const by_chunk = world.traders.reduce((map, { x, z, y, name }, i) => {
    const chunk_x = chunk_position(x)
    const chunk_z = chunk_position(z)
    const index = chunk_index(chunk_x, chunk_z)
    const entry = map.get(index) || []
    return new Map([
      ...map.entries(),
      [index, [...entry, { x, z, y, name, id: world.next_entity_id + i }]],
    ])
  }, new Map())

  const recipes = world.traders.map(({ recipes, name }, i) => {
    return { id: world.next_entity_id + i, recipes, name }
  })

  const windowIds = new Map(
    recipes.map(({ id, recipes, name }, i) => [
      id,
      {
        windowId: world.next_window_id + i,
        recipes,
        name,
      },
    ])
  )

  return {
    ...world,
    next_entity_id: world.next_entity_id + world.traders.length,
    next_window_id: world.next_window_id + windowIds.size,
    traders: {
      by_chunk,
      windowIds,
    },
  }
}

/** @type {import('../context.js').Observer} */
function spawn_merchants({ client, events, world }) {
  const { by_chunk } = world.traders
  const { id: type } = mcData.entitiesByName.villager
  events.on(Context.CHUNK_LOADED, ({ x: chunk_x, z: chunk_z }) => {
    if (by_chunk.has(chunk_index(chunk_x, chunk_z))) {
      for (const { id, name, x, y, z } of by_chunk.get(
        chunk_index(chunk_x, chunk_z)
      )) {
        const villager = {
          entityId: id,
          entityUUID: UUID.v4(),
          type,
          x,
          y,
          z,
          yaw: 0,
          pitch: 0,
          headPitch: 0,
          velocityX: 0,
          velocityY: 0,
          velocityZ: 0,
        }
        const metadata = {
          entityId: id,
          metadata: [
            {
              key: 2,
              value: JSON.stringify(`${name}`),
              type: 5,
            },
            {
              key: 3,
              type: 7,
              value: true,
            },
          ],
        }
        client.write('spawn_entity_living', villager)
        client.write('entity_metadata', metadata)
      }
    }
  })

  events.on(Context.CHUNK_UNLOADED, ({ x, z }) => {
    if (by_chunk.has(chunk_index(x, z))) {
      client.write('entity_destroy', {
        entityIds: by_chunk.get(chunk_index(x, z)).map(({ id }) => id),
      })
    }
  })
}

/** @type {import('../context.js').Observer} */
function open_trade({ client, world }) {
  const { windowIds } = world.traders
  const right_click = 2
  const inventoryType = 18
  client.on('use_entity', ({ target, mouse, sneaking }) => {
    if (windowIds.has(target) && mouse === right_click && sneaking === false) {
      const { name, windowId, recipes: ares_recipe } = windowIds.get(target)
      const mc_recipe = ares_recipe.map(trade => {
        const { inputItem1, inputItem2, outputItem } = trade
        const to_slot = item =>
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

/** @type {import('../context.js').Observer} */
function look_player({ client, world, events }) {
  events.on(Context.STATE, ({ position: { x, z } }) => {
    const { by_chunk } = world.traders
    const x_chunks = [
      chunk_position(x) - 1,
      chunk_position(x),
      chunk_position(x) + 1,
    ]
    const z_chunks = [
      chunk_position(z) - 1,
      chunk_position(z),
      chunk_position(z) + 1,
    ]
    for (const i of x_chunks) {
      for (const j of z_chunks) {
        if (by_chunk.has(chunk_index(i, j))) {
          for (const trader of by_chunk.get(chunk_index(i, j))) {
            const yaw = Math.floor(
              (-Math.atan2(x - trader.x, z - trader.z) / Math.PI) * (255 / 2)
            )
            const entityId = trader.id
            client.write('entity_head_rotation', {
              entityId,
              headYaw: yaw,
            })
          }
        }
      }
    }
  })
}

export default {
  /** @type {import('../context.js').Observer} */
  observe(context) {
    spawn_merchants(context)
    open_trade(context)
    look_player(context)
  },
}
