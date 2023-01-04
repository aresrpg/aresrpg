import equal from 'fast-deep-equal'

import { client_chat_msg } from '../chat.js'
import { get_block } from '../chunk.js'

const interactable_types = {
  trap: 222,
  door: 161,
}

const door_state = {
  upper: 3576,
  bottom: 3584,
}

function update_door(position) {
  const { x, y, z } = position
  const upper_location = {
    x,
    y: y + 1,
    z,
  }

  const upper = {
    location: upper_location,
    type: door_state.upper,
  }
  const bottom = {
    location: position,
    type: door_state.bottom,
  }

  return [upper, bottom]
}

/**
 * This function permit to allow or deny some interaction with specific block
 * Block interaction : world/{floor}/interactable_object.json
 * |   id   |   blockname   |
 * |  250   |  fence gate   |
 * |  222   |  trap door    |
 * |  161   |  door         |
 */
export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, world }) {
    client.on('block_place', async ({ location }) => {
      const block = await get_block(world, location)

      const handle_interactable = async ({ position, message, type }) => {
        if (message) client_chat_msg({ client, message })

        if (type === interactable_types.door) {
          update_door(position).forEach(block => {
            client.write('block_change', block)
          })
        } else {
          client.write('block_change', {
            location,
            type: block.stateId,
          })
        }
      }

      const interacted_object = world.interactable_object.find(payload => {
        const { position, type } = payload

        if (block.type === interactable_types.door) {
          // check if the upper block is interacted
          const { x, y, z } = position
          const upper_door = {
            x,
            y: y + 1,
            z,
          }

          if (equal(upper_door, location)) return payload
        }

        if (equal(position, location)) return payload

        // NEED TO CHANGE
        if (position === '*' && type === block.type) return payload

        return undefined
      })

      if (interacted_object) handle_interactable(interacted_object)
    })
  },
}
