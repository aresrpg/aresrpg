import nbt from 'prismarine-nbt'
import minecraftData from 'minecraft-data'

import { to_vanilla_item } from '../items.js'
import logger from '../logger.js'
import execute_command from '../commands/commands.js'
import { VERSION } from '../settings.js'
import { world_chat_msg } from '../chat.js'
import { WorldRequest } from '../events.js'
import emotes from '../../data/emotes.json' assert { type: 'json' }

import { closest_stone } from './teleportation_stones.js'
const mcData = minecraftData(VERSION)
const log = logger(import.meta)

function is_command_function(message) {
  return message.trimStart()[0] === '/'
}

function serialize_item({ nbtData, itemCount, itemId }) {
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

function serialize_emote(emote) {
  const emote_name = emote.slice(1, -1)

  if (!emotes.includes(emote_name)) {
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
        const item = inventory.hotbar[held_slot_index]
        console.dir({
          item,
          hotbar: inventory.hotbar,
        })
        if (item !== undefined) return serialize_item(to_vanilla_item(item))
        return undefined
      },
      [/%item\d%/.source]: word => {
        const slot_number = Math.max(
          0,
          Math.min(parseInt(word.match(/\d/)[0]), 8)
        )
        const { inventory } = get_state()
        const item = inventory.hotbar[slot_number]
        if (item !== undefined) return serialize_item(to_vanilla_item(item))
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
      [/:.*:/.source]: serialize_emote, // all emotes name are between ":"
    }

    const split_regex = new RegExp(`(${Object.keys(chat_mapper).join('|')})`)

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
            message.split(split_regex).map(part => {
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
