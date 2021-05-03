import nbt from 'prismarine-nbt'
import minecraftData from 'minecraft-data'

import { item_to_slot } from '../items.js'
import { version } from '../settings.js'
import logger from '../logger.js'
import execute_command from '../commands/commands.js'

const mcData = minecraftData(version)
const log = logger(import.meta)

export const Position = {
  CHAT: 0, // appears in the chat box
  SYSTEM_MESSAGE: 1, // appears in the chat box
  GAME_INFO: 2, // appears above the hotbar
}

function is_command_function(message) {
  return message.trimStart()[0] === '/'
}

export function slot_to_chat({ nbtData, itemCount, itemId }) {
  const tag = nbt.simplify(nbtData)
  const { name } = mcData.items[itemId]

  const chat = {
    ...JSON.parse(tag.display.Name),
    hoverEvent: {
      action: 'show_item',
      contents: {
        id: name,
        itemCount,
        tag: JSON.stringify(tag),
      },
    },
  }
  return chat
}

export function write_chat_msg({ world }, { message, client: { uuid } }) {
  const options = {
    message,
    position: Position.CHAT,
    sender: uuid,
  }
  world.events.emit('chat', options)
}

export default {
  /** @type {import('../index.js').Observer} */
  observe({ client, get_state, world }) {
    client.on('chat', (packet) => {
      const { message } = packet

      if (is_command_function(message)) {
        log.debug({ sender: client.uuid, command: message }, 'Command')
        execute_command({ world, message, sender: client })
        return
      } else {
        log.debug({ sender: client.uuid, message }, 'Message')
      }

      const formatted_message = message.split(/(%item\d%)/).map((part) => {
        if (part.match(/(%item\d%)/)) {
          const slot_number = parseInt(part.match(/\d/)[0]) + 36 // For the player 0 is the first item in hotbar. But for the game the hotbat begin at 36.
          const { inventory } = get_state()
          const item = inventory[slot_number]
          if (item) {
            const { type, count } = item
            return slot_to_chat(item_to_slot(world.items[type], count))
          }
        }
        return { text: part }
      })

      const message_for_client = {
        translate: 'chat.type.text',
        with: [
          {
            text: client.username,
          },
          formatted_message,
        ],
      }
      write_chat_msg(
        { world },
        { message: JSON.stringify(message_for_client), client }
      )
    })
    world.events.on('chat', (options) => client.write('chat', options))
    world.events.on('private_message', ({ receiver_username, options }) => {
      if (receiver_username === client.username) client.write('chat', options)
    })
  },
}
