import nbt from 'prismarine-nbt'
import minecraftData from 'minecraft-data'

import { item_to_slot } from '../items.js'
import logger from '../logger.js'
import execute_command from '../commands/commands.js'
import { VERSION } from '../settings.js'
import { world_chat_msg } from '../chat.js'
import { World } from '../events.js'
import items from '../../data/items.json' assert { type: 'json' }

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

function share_pos(x,y) {
  const chat = {
    translate:"chat.type.text",
    text:"Position", color: 'gold', 
    hoverEvent: {
      action:"show_text",
      value:"X: "+x+" Y: "+y},
    }
  return chat
}

export default {
  /** @type {import('../context.js').Observer} */
  observe({ client, get_state, world, dispatch }) {
    client.on('chat', packet => {
      const { message } = packet

      if (is_command_function(message)) {
        log.info({ sender: client.uuid, command: message }, 'Command')
        execute_command({ world, message, sender: client, get_state, dispatch })
        return
      } else {
        log.info({ sender: client.uuid, message }, 'Message')
      }

      function sh_item(){
        if (message.match(/(%item\d%)/)){
          const share_specific_item = message.split(/(%item\d%)/).map(part => {
            if (part.match(/(%item\d%)/)) {
              const slot_number = parseInt(part.match(/\d/)[0]) + 36 // For the player 0 is the first item in hotbar. But for the game the hotbat begin at 36.
              const { inventory } = get_state()
              const item = inventory[slot_number]
              if (item) {
                const { type, count } = item
                return slot_to_chat(item_to_slot(items[type], count))
              }
            }
            return { text: part }
          })
          world_chat_msg({
            world,
            message: {
              translate: 'chat.type.text',
              with: [
                {
                  text: client.username,
                },
                share_specific_item,
              ],
            },
            client,
          })
        }

        else if (message.match(/(%pos%)/)) {
          const pos_link = message.split(/(%pos%)/).map(part => {
            if (part.match(/(%pos%)/)) {
              const { position } = get_state()
              var posX = position["x"]
              var posY = position["y"]
              const StrPos = share_pos(posX,posY)
              if (StrPos){
                return StrPos
              }
            }
            return { text: part }
          })
          world_chat_msg({
            world,
            message: {
              translate: 'chat.type.text',
              with: [
                {
                  text: client.username,
                },
                [pos_link],
              ],
            },
            client,
          })
        }

        else if (message.match(/(%item%)/)) {
          const share_hand_item = message.split(/(%item%)/).map(part => {
            if (part.match(/(%item%)/)) {
              const { held_slot_index } = get_state()
              const { inventory } = get_state()
              const slot_number = held_slot_index + 36; //Same here
              const item = inventory[slot_number]
              if (item) {
                const { type, count } = item
                return slot_to_chat(item_to_slot(items[type], count))
              }
            }
            return { text: part }
          })
          world_chat_msg({
            world,
            message: {
              translate: 'chat.type.text',
              with: [
                {
                  text: client.username,
                },
                share_hand_item
              ],
            },
            client,
          })
        }

        else{
          return true
        }
      }

      if(message){
        if (sh_item() == true){
          world_chat_msg({
            world,
            message: {
              translate: 'chat.type.text',
              with: [
                {
                  text: client.username,
                },
                message,
              ],
            },
            client
          })
        }
      }
      
    })
    const on_chat = options => client.write('chat', options)
    const on_private_message = ({ receiver_username, options }) => {
      if (receiver_username === client.username) client.write('chat', options)
    }

    world.events.on(World.CHAT, on_chat)
    world.events.on(World.PRIVATE_MESSAGE, on_private_message)

    client.once('end', () => {
      world.events.off(World.CHAT, on_chat)
      world.events.off(World.PRIVATE_MESSAGE, on_private_message)
    })
  },
}
