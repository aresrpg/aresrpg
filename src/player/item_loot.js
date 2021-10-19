import { on } from 'events'

import { aiter } from 'iterator-helper'
import minecraft_data from 'minecraft-data'
import UUID from 'uuid-1345'

import { abortable } from '../iterator.js'
import { distance3d_squared } from '../math.js'
import { block_position_equal } from '../position.js'
import { VERSION, PLAYER_ENTITY_ID } from '../settings.js'
import { item_to_slot } from '../items.js'
import { Action, Context } from '../events.js'

import { USABLE_INVENTORY_START, USABLE_INVENTORY_END } from './inventory.js'

const { entitiesByName } = minecraft_data(VERSION)

export const ITEM_LOOT_MAX_COUNT = 100

/** @param {import('../context.js').InitialWorld} world */
export function register(world) {
  return {
    ...world,
    item_loot_start_id: world.next_entity_id,
    next_entity_id: world.next_entity_id + ITEM_LOOT_MAX_COUNT,
  }
}

function spawn_item_entity({ client, entity_id, item, world }) {
  client.write('spawn_entity', {
    entityId: entity_id,
    objectUUID: UUID.v4(),
    type: entitiesByName.item.id,
    x: item.position.x,
    y: item.position.y,
    z: item.position.z,
    yaw: 0,
    pitch: 0,
    objectData: 1,
    velocityX: 0,
    velocityY: 0,
    velocityZ: 0,
  })

  client.write('entity_metadata', {
    entityId: entity_id,
    metadata: [
      {
        key: 0,
        type: 0,
        value: 0x40,
      },
      {
        key: 7,
        type: 6,
        value: item_to_slot(world.items[item.type], item.count),
      },
    ],
  })
}

export default {
  /** @type {import('../context.js').Reducer} */
  reduce(state, { type, payload }) {
    if (type === Action.LOOT_ITEM) {
      const { type, count, position } = payload
      const cursor = (state.looted_items.cursor + 1) % ITEM_LOOT_MAX_COUNT
      const pool = [
        ...state.looted_items.pool.slice(0, cursor),
        { type, count, position },
        ...state.looted_items.pool.slice(cursor + 1),
      ]

      return {
        ...state,
        looted_items: { cursor, pool },
      }
    }
    if (type === Action.PICK_ITEM) {
      const position = state.looted_items.pool.indexOf(payload)
      if (position === -1) return state

      const compatible_inventory_slot = state.inventory.findIndex(
        (item, slot) =>
          item?.type === payload.type &&
          slot >= USABLE_INVENTORY_START &&
          slot <= USABLE_INVENTORY_END
      )

      const empty_inventory_slot = state.inventory.findIndex(
        (item, slot) =>
          item == null &&
          slot >= USABLE_INVENTORY_START &&
          slot <= USABLE_INVENTORY_END
      )

      // Item go in priority into a compatible slot
      const inventory_slot =
        compatible_inventory_slot === -1
          ? empty_inventory_slot
          : compatible_inventory_slot

      if (inventory_slot !== -1) {
        const { type, count } = state.looted_items.pool[position]
        return {
          ...state,
          looted_items: {
            ...state.looted_items,
            pool: [
              ...state.looted_items.pool.slice(0, position),
              null,
              ...state.looted_items.pool.slice(position + 1),
            ],
          },
          inventory: [
            ...state.inventory.slice(0, inventory_slot),
            {
              type,
              count: count + (state.inventory[inventory_slot]?.count ?? 0),
            },
            ...state.inventory.slice(inventory_slot + 1),
          ],
          inventory_sequence_number: state.inventory_sequence_number + 1,
        }
      }
    }
    return state
  },
  /** @type {import('../context.js').Observer} */
  observe({ client, events, signal, dispatch, world }) {
    aiter(abortable(on(events, Context.STATE, { signal })))
      .map(([{ looted_items }]) => looted_items)
      .reduce((last_looted_items, looted_items) => {
        if (last_looted_items !== looted_items) {
          const difference = (a, b) =>
            a
              .map((item, index) => ({ item, index }))
              .filter(({ item }) => item != null && !b.includes(item))

          const added = difference(looted_items.pool, last_looted_items.pool)
          const removed = difference(last_looted_items.pool, looted_items.pool)

          // If the cursor didn't changed it's an item pickup
          if (looted_items.cursor === last_looted_items.cursor) {
            for (const { item, index } of removed) {
              client.write('collect', {
                collectedEntityId: world.item_loot_start_id + index,
                collectorEntityId: PLAYER_ENTITY_ID,
                pickupItemCount: item.count,
              })
            }
          }

          client.write('entity_destroy', {
            entityIds: removed.map(
              ({ index }) => world.item_loot_start_id + index
            ),
          })

          for (const { item, index } of added) {
            spawn_item_entity({
              client,
              entity_id: world.item_loot_start_id + index,
              item,
              world,
            })
          }
        }

        return looted_items
      })

    aiter(abortable(on(events, Context.STATE, { signal })))
      .map(([{ position, looted_items }]) => ({ position, looted_items }))
      .reduce(
        (
          { position: last_position, looted_items: last_looted_items },
          value
        ) => {
          const { position, looted_items } = value
          if (
            !block_position_equal(last_position, position) ||
            looted_items !== last_looted_items
          ) {
            const near_items = looted_items.pool.filter(
              item =>
                item != null &&
                distance3d_squared(item.position, position) <= 2 ** 2
            )

            for (const item of near_items) {
              dispatch(Action.PICK_ITEM, item)
            }
          }

          return value
        }
      )
  },
}
