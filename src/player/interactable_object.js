import { client_chat_msg } from '../chat.js'
import { get_block } from '../chunk.js'

const DOOR_TYPE = 161

const PERMIT = {
  ALLOW: 'allow',
  DENY: 'deny',
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
  observe(context) {
    const { client, world } = context
    client.on('block_place', async ({ location }) => {
      const block = await get_block(world, location)

      /*
       * Find if the block is on the interact block list
       * Can't use const beacuse door is not the same condition
       */
      let interact_object

      // TAG is used for know if the client click on the toppom or bottom of the door
      let tag = 0

      /**
       * If the block is the door we need to show if the bottom block is on the interactale object list
       */
      if (block.type === DOOR_TYPE) {
        interact_object = world.interactable_object.find(
          ({ type, location: loc }) =>
            type === block.type &&
            ((location.x === loc.x &&
              (location.y === loc.y || location.y - 1 === loc.y) &&
              location.z === loc.z) ||
              loc === '*')
        )

        if (
          interact_object !== undefined &&
          interact_object.location.y !== location.y
        )
          tag = 1
      } else {
        interact_object = world.interactable_object.find(
          ({ type, location: loc }) =>
            type === block.type &&
            ((location.x === loc.x &&
              location.y === loc.y &&
              location.z === loc.z) ||
              loc === '*')
        )
      }

      if (interact_object !== undefined) {
        if (interact_object.permit === PERMIT.DENY) {
          /* CANCEL ACTION */
          client.write('block_change', {
            location,
            type: block.stateId,
          })

          if (interact_object.custom_message !== undefined)
            client_chat_msg({ client, message: interact_object.custom_message })

          if (block.type === DOOR_TYPE) {
            const locblock2 = {
              x: location.x,
              z: location.z,
              y: tag === 0 ? location.y + 1 : location.y - 1,
            }
            const block2 = await get_block(world, locblock2)
            client.write('block_change', {
              location: locblock2,
              type: block2.stateId,
            })
          }
        }
      }
    })
  },
}
