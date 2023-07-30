import { on } from 'events'

import { aiter } from 'iterator-helper'

import { abortable } from '../iterator.js'
import { block_position } from '../position.js'
import { get_block, same_position } from '../chunk.js'

const CANCELLING_FALL_DAMAGE_BLOCKS = [
  // guess falling on top of a ladder is fine
  'ladder',
  'slime_block',
  'vine',
  'water',
  'honey',
  'hay_block',
]

export default {
  /** @type {import('../context.js').Observer} */
  observe({ events, dispatch, signal, world }) {
    aiter(abortable(on(events, 'STATE_UPDATED', { signal })))
      .map(([{ position, teleport }]) => ({ position, teleport }))
      .reduce(
        async (
          { highest_y, was_on_ground, last_teleport, last_block_position },
          { position, teleport },
        ) => {
          const current_block_position = block_position(position)
          const { y, onGround } = position
          const result = {
            highest_y,
            was_on_ground: onGround,
            last_teleport: teleport,
            last_block_position: current_block_position,
          }

          // if the player moved and is not on the ground,
          // we need to check if their current block is a block that cancels fall damage (like water) to reset the highest_y
          if (!same_position(current_block_position, last_block_position)) {
            if (!onGround) {
              const block = await get_block(world, current_block_position)
              const just_teleported = !teleport && last_teleport
              const can_reset_y =
                just_teleported ||
                CANCELLING_FALL_DAMAGE_BLOCKS.includes(block.name)

              return {
                ...result,
                highest_y: can_reset_y ? y : Math.max(highest_y, y),
              }
            }
          }

          // if the player reached the ground from the air, we need to check if they fell from a high enough place to inflict damage
          if (!was_on_ground && onGround) {
            const block_below = await get_block(world, {
              ...current_block_position,
              y: current_block_position.y - 1,
            })
            const block = await get_block(world, current_block_position)

            if (
              CANCELLING_FALL_DAMAGE_BLOCKS.includes(block_below.name) ||
              CANCELLING_FALL_DAMAGE_BLOCKS.includes(block.name)
            )
              return {
                ...result,
                highest_y: y,
              }

            const fall_distance = highest_y - y
            const raw_damage = fall_distance / 2 - 1.5
            const damage = Math.round(raw_damage * 2) / 2

            if (damage > 0) events.emit('RECEIVE_DAMAGE', { damage })
            return {
              ...result,
              highest_y: y,
            }
          }

          return result
        },
        {
          highest_y: 0,
          was_on_ground: true,
          last_teleport: null,
          last_block_position: null,
        },
      )
  },
}
