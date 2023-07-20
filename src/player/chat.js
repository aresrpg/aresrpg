import nbt from 'prismarine-nbt'
import minecraftData from 'minecraft-data'

import { to_vanilla_item } from '../items.js'
import logger from '../logger.js'
import execute_command from '../commands/commands.js'
import { VERSION } from '../settings.js'
import { world_chat_msg } from '../chat.js'
import { WorldRequest } from '../events.js'
import emotes from '../../data/emotes.json' assert { type: 'json' }
import { Font } from '../font.js'

import { closest_stone } from './teleportation_stones.js'
const mcData = minecraftData(VERSION)
const log = logger(import.meta)

function is_command_function(message) {
  return message.trimStart()[0] === '/'
}

/**
 *
 * @param {object} options
 * @param {boolean} options.present
 * @param {any=} options.nbtData
 * @param {number=} options.itemCount
 * @param {number=} options.itemId
 */
function serialize_item(name, { present, nbtData, itemCount, itemId }) {
  if (present === false) return undefined

  const tag = nbt.simplify(nbtData)
  return [
    Font.ITEM.chat_prefix,
    {
      ...Font.DEFAULT(` [${name}]`),
      color: '#BDC3C7',
      hoverEvent: {
        action: 'show_item',
        contents: {
          id: mcData.items[itemId].name,
          itemCount,
          tag: JSON.stringify(tag),
        },
      },
    },
  ]
}

function serialize_emote(emote) {
  const emote_name = emote.slice(1, -1)

  if (!emotes.includes(emote_name)) {
    return { text: emote }
  }

  return {
    ...Font.EMOTES(emote_name),
    hoverEvent: {
      action: 'show_text',
      value: emote,
    },
  }
}

function printable_items({
  head,
  neck,
  chest,
  rings,
  belt,
  legs,
  feet,
  pet,
  weapon,
  relics,
}) {
  return {
    head,
    neck,
    chest,
    ring1: rings[0],
    ring2: rings[1],
    belt,
    legs,
    feet,
    pet,
    weapon,
    ...Object.fromEntries(
      relics.map((relic, index) => [`relic${index + 1}`, relic]),
    ),
  }
}

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, get_state, world, dispatch }) {
    const chat_mapper = {
      '%pos%': () => {
        const { position } = get_state()
        const closest_zone =
          closest_stone(world, position)?.name ?? 'Wilderness'
        return {
          text: `Position: ${closest_zone}`,
          color: 'gold',
          hoverEvent: {
            action: 'show_text',
            value: `X: ${Math.round(position.x)} Z: ${Math.round(position.z)}`,
          },
        }
      },
      [/%.*%/.source]: name => {
        const state = get_state()
        const { inventory } = state
        const printable = printable_items(inventory)
        const item = printable[name.slice(1, -1)]
        if (item) return serialize_item(item.name, to_vanilla_item(item, state))
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
            message
              .split(split_regex)
              .flatMap(part => {
                for (const pattern in chat_mapper)
                  if (
                    part.match(pattern) &&
                    chat_mapper[pattern](part) !== undefined
                  )
                    return chat_mapper[pattern](part)
                return { text: part }
              })
              // make sure we don't send any nulls
              .filter(Boolean),
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
    world.events.on(WorldRequest.SEND_PRIVATE_MESSAGE, on_private_message)

    client.once('end', () => {
      world.events.off(WorldRequest.SEND_CHAT_MESSAGE, on_chat)
      world.events.off(WorldRequest.SEND_PRIVATE_MESSAGE, on_private_message)
    })
  },
}
