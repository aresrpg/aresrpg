import { World } from './events.js'
import { SERVER_UUID } from './settings.js'

/**
 * Take anything as an input and output an array of chat component
 */
export function normalize_chat_component(component) {
  if (!component) return [{ text: '' }]
  if (typeof component === 'string') return [{ text: component }]
  if (!Array.isArray(component)) return [component]
  return component
}

export const MAGIC_RESET = '§r'

export const Formats = {
  BASE: {
    color: '#ECF0F1',
    italic: true,
    bold: false,
    underline: false,
  },
  SUCCESS: {
    color: '#2ECC71',
    italic: false,
    bold: true,
    underline: false,
  },
  WARN: {
    color: '#F1C40F',
    italic: false,
    bold: true,
    underline: false,
  },
  INFO: {
    color: '#3498DB',
    italic: false,
    bold: true,
    underline: false,
  },
  DANGER: {
    color: '#E74C3C',
    italic: false,
    bold: true,
    underline: false,
  },
  CLICKABLE_ITEM: {
    color: '#9B59B6',
    underline: true,
    italic: false,
  },
  CLICKABLE_ENTITY: {
    color: '#34495E',
    underline: true,
    italic: false,
  },
}

export const Position = {
  CHAT: 0, // appears in the chat box
  SYSTEM_MESSAGE: 1, // appears in the chat box
  GAME_INFO: 2, // appears above the hotbar
}

export function client_chat_msg({ client, message }) {
  client.write('chat', {
    message: JSON.stringify([
      { text: '> ', color: '#C0392B' },
      ...[message].flat(),
    ]),
    position: Position.CHAT,
    sender: SERVER_UUID,
  })
}

export function world_chat_msg({ world, message, client: { uuid: sender } }) {
  const options = {
    message: JSON.stringify(message),
    position: Position.CHAT,
    sender,
  }
  world.events.emit(World.CHAT, options)
}
