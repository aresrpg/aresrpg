import { SERVER_UUID } from './settings.js'

/**
 * Take a string or a chat component as an input and output a chat component
 */
export function normalize_chat_component(component) {
  if (!component) return [{ text: '' }]
  if (typeof component === 'string') return [{ text: component }]
  if (!Array.isArray(component)) return [component]
  return component
}

export const MAGIC_RESET = '§r'

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
    message,
    position: Position.CHAT,
    sender,
  }
  world.events.emit('chat', options)
}
