export const Position = {
  CHAT: 0, // appears in the chat box
  SYSTEM_MESSAGE: 1, // appears in the chat box
  GAME_INFO: 2, // appears above the hotbar
}

export const chat_color = {
  black: '§0',
  dark_blue: '§1',
  dark_green: '§2',
  dark_cyan: '§3',
  dark_red: '§4',
  purple: '§5',
  gold: '§6',
  gray: '§7',
  dark_gray: '§8',
  blue: '§9',
  bright_green: '§a',
  cyan: '§b',
  red: '§c',
  pink: '§d',
  yellow: '§e',
  white: '§f',
}

export function write_chat_msg(
  { server: { clients } },
  { message, client: { uuid } }
) {
  const options = {
    message,
    position: Position.CHAT,
    sender: uuid,
  }
  const send_packet = (client) => client.write('chat', options)
  Object.values(clients).forEach(send_packet)
}

export default function chat({ server, client }) {
  client.on('chat', (packet) => {
    const message = {
      translate: 'chat.type.text',
      with: [
        {
          text: client.username,
        },
        {
          text: packet.message,
        },
      ],
    }

    write_chat_msg({ server }, { message: JSON.stringify(message), client })
  })
}
