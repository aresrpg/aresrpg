import nbt from 'prismarine-nbt'
import minecraftData from 'minecraft-data'

import { item_to_slot } from '../items.js'
import logger from '../logger.js'
import execute_command from '../commands/commands.js'
import { VERSION } from '../settings.js'
import { world_chat_msg } from '../chat.js'
import { WorldRequest } from '../events.js'
import { Emotes, Items } from '../data.js'

import { closest_stone } from './teleportation_stones.js'
const mcData = minecraftData(VERSION)
const log = logger(import.meta)

function is_command_function(message) {
  return message.trimStart()[0] === '/'
}

function slot_to_chat({ nbtData, itemCount, itemId }) {
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

function emote_to_chat(emote) {
  const emote_name = emote.slice(1, -1)

  if (!Emotes.includes(emote_name)) {
    return { text: emote }
  }

  return {
    translate: `aresrpg.emotes.${emote_name}`,
    font: 'aresrpg:emotes',
    hoverEvent: {
      action: 'show_text',
      value: emote,
    },
    with: [
      {
        text: emote_name,
      },
    ],
  }
}

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, get_state, world, dispatch }) {
    const chat_mapper = {
      '%item%': () => {
        const { held_slot_index, inventory } = get_state()
        const item = inventory[held_slot_index + 36] // For the player 0 is the first item in hotbar. But for the game the hotbat begin at 36.
        if (item !== undefined) {
          const { type, count } = item
          return slot_to_chat(item_to_slot(Items[type], count))
        }
        return undefined
      },
      [/%item\d%/.source]: word => {
        const slot_number = parseInt(word.match(/\d/)[0]) + 36 // same
        const { inventory } = get_state()
        const item = inventory[slot_number]
        if (item !== undefined) {
          const { type, count } = item
          return slot_to_chat(item_to_slot(Items[type], count))
        }
        return undefined
      },
      '%pos%': () => {
        const { position } = get_state()
        const closest_zone =
          closest_stone(world, position)?.name ?? 'Wilderness'
        const chat = {
          text: `Position: ${closest_zone}`,
          color: 'gold',
          hoverEvent: {
            action: 'show_text',
            value: `X: ${Math.round(position.x)} Z: ${Math.round(position.z)}`,
          },
        }
        return chat
      },
      [/:.*:/.source]: emote_to_chat, // all emotes name are between ":"
    }

    client.on('chat', ({ message }) => {
      if (is_command_function(message)) {
        log.info({ sender: client.uuid, command: message }, 'Command')
        execute_command({ world, message, sender: client, get_state, dispatch })
        return
      } else {
        log.info({ sender: client.uuid, message }, 'Message')
      }

      world_chat_msg({
        world,
        message: {
          translate: 'chat.type.text',
          with: [
            {
              text: client.username,
            },
            message
              .split(new RegExp(`(${Object.keys(chat_mapper).join('|')})`))
              .map(part => {
                for (const pattern in chat_mapper)
                  if (
                    part.match(pattern) &&
                    chat_mapper[pattern](part) !== undefined
                  )
                    return chat_mapper[pattern](part)
                return { text: part }
              }),
          ],
        },
        client,
      })
    })
    const on_chat = options => client.write('chat', options)
    const on_private_message = ({ receiver_username, options }) => {
      if (receiver_username === client.username) client.write('chat', options)
    }

    world.events.on(WorldRequest.SEND_CHAT_MESSAGE, on_chat)
    world.events.on(WorldRequest.PRIVATE_MESSAGE, on_private_message)

    client.once('end', () => {
      world.events.off(WorldRequest.SEND_CHAT_MESSAGE, on_chat)
      world.events.off(WorldRequest.PRIVATE_MESSAGE, on_private_message)
    })
  },
}
